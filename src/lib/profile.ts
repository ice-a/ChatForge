import { getLatestProfile, getSettings, initDb, saveProfile, saveSetting, sampleUserTexts, getToolSummary, getModelUsage, getTopProjects } from './db';
import { chatLLM, extractJsonLoose } from './llm';
import { extractTechStats } from './techstack';
import type { LlmConfig, UserProfile } from '../types';

const PROFILE_SYSTEM = `你是一位资深的开发者画像分析师。用户会提供他从多个 AI 编程工具中导出的会话数据摘要（工具名、项目、提问内容）。
请基于这些证据，输出一份全面、客观、有依据的用户画像。
要求：
- 只依据数据中出现的证据，不要凭空编造；证据不足时降低评分并在 evidence 里说明。
- 所有文字用中文（专有名词保留英文）。
- 只输出一个 JSON 对象，不要输出任何其他文字、解释或代码块标记。

JSON 结构如下：
{
  "nickname": "给用户起的简短画像称呼（如：全栈 RAG 建设者）",
  "archetype": "开发者类型（如：全栈工程师 / AI 应用开发者 / 前端工程师…）",
  "summary": "2~4句总述",
  "dimensions": [ { "name": "维度名", "score": 1-5的整数, "evidence": "依据" } ],   // 6~8个维度，覆盖：前端、后端、AI/LLM应用、DevOps/部署、数据、架构设计、工程效率、领域知识等，按实际证据选最相关的
  "techStack": { "languages": [], "frameworks": [], "tools": [], "aiTools": [] },  // 从会话中提炼
  "interests": ["兴趣/关注领域", ...],
  "workHabits": { "activeHours": "活跃时段描述", "sessionStyle": "会话习惯（长短/迭代方式）", "questionStyle": "提问风格" },
  "collaborationStyle": "与 AI 协作的风格描述（2~3句）",
  "memory": [ "可用于写入 AGENTS.md/CLAUDE.md 的智能体记忆条目，每条一句话、第二人称'用户…'，8~14条" ],
  "highlights": ["值得注意的亮点或建议", ...]
}`;

export async function generateProfileWithLLM(homeDir: string, cfg: LlmConfig, onProgress?: (msg: string) => void): Promise<UserProfile> {
  const db = await initDb(homeDir);
  onProgress?.('收集会话素材…');
  const [samples, toolSummary, modelUsage, topProjects] = await Promise.all([
    sampleUserTexts(db, 300, 220),
    getToolSummary(db),
    getModelUsage(db),
    getTopProjects(db, 10),
  ]);
  if (!samples.length) throw new Error('还没有会话数据，请先在设置页扫描会话来源');

  const statsBlock = [
    '## 各工具使用统计',
    ...toolSummary.map((t) => `- ${t.tool}: ${t.sessions} 会话 / ${t.msgs} 消息 / 输入token ${t.tokens_in} / 输出token ${t.tokens_out}`),
    '',
    '## 模型使用',
    ...modelUsage.slice(0, 20).map((m) => `- ${m.tool} × ${m.model}: ${m.sessions} 会话 / ${m.msgs} 消息`),
    '',
    '## 主要项目',
    ...topProjects.map((p) => `- ${p.project}: ${p.sessions} 会话 / ${p.msgs} 消息`),
  ].join('\n');

  const user = `${statsBlock}

## 近期会话抽样（用户输入摘录，共 ${samples.length} 条）
${samples.join('\n')}

请输出 JSON 画像。`;

  onProgress?.(`调用 ${cfg.model} 生成画像…`);
  const reply = await chatLLM(cfg, PROFILE_SYSTEM, user, 8000);
  onProgress?.('解析画像结果…');
  const parsed = extractJsonLoose(reply.text) as Partial<UserProfile>;
  const profile = normalizeProfile(parsed, 'llm');
  await saveProfile(db, profile, reply.model || cfg.model, 'llm');
  return profile;
}

/** 无 LLM 的本地规则版画像：保证开箱即有内容 */
export async function generateRuleProfile(homeDir: string): Promise<UserProfile> {
  const db = await initDb(homeDir);
  const [samples, toolSummary, topProjects] = await Promise.all([
    sampleUserTexts(db, 400, 300),
    getToolSummary(db),
    getTopProjects(db, 10),
  ]);
  if (!samples.length) throw new Error('还没有会话数据，请先在设置页扫描会话来源');
  const techs = extractTechStats(samples);
  const byCat = (c: string) => techs.filter((t) => t.category === c).slice(0, 10).map((t) => t.label);
  const aiTools = toolSummary.map((t) => t.tool);

  const dims: UserProfile['dimensions'] = [
    { name: 'AI 工具使用', score: Math.min(5, 1 + Math.round(toolSummary.reduce((a, t) => a + t.sessions, 0) / 40)), evidence: `共 ${toolSummary.reduce((a, t) => a + t.sessions, 0)} 个会话，覆盖 ${toolSummary.length} 个工具` },
    { name: byCat('language').length ? `语言（${byCat('language').slice(0, 3).join('/')}）` : '编程语言', score: Math.min(5, 1 + byCat('language').length), evidence: byCat('language').join('、') || '样本中未识别到明确语言' },
    { name: byCat('framework').length ? `框架（${byCat('framework').slice(0, 3).join('/')}）` : '框架', score: Math.min(5, 1 + byCat('framework').length), evidence: byCat('framework').join('、') || '样本中未识别到明确框架' },
    { name: 'DevOps/部署', score: Math.min(5, byCat('tool').length), evidence: byCat('tool').join('、') || '证据较少' },
    { name: 'AI/LLM 应用', score: Math.min(5, 1 + byCat('ai').length), evidence: byCat('ai').join('、') || '证据较少' },
    { name: '项目广度', score: Math.min(5, 1 + Math.round(topProjects.length / 3)), evidence: `涉及 ${topProjects.length} 个项目：${topProjects.slice(0, 5).map((p) => p.project).join('、')}` },
  ];

  const profile: UserProfile = {
    nickname: '多工具 AI 编程用户',
    archetype: aiTools.length > 3 ? '多工具 AI 重度用户' : 'AI 辅助开发者',
    summary: `本地规则版画像（未使用大模型）：共扫描到 ${toolSummary.reduce((a, t) => a + t.sessions, 0)} 个会话，覆盖 ${toolSummary.length} 个工具。主要项目：${topProjects.slice(0, 5).map((p) => p.project).join('、')}。配置第三方大模型后可生成更深入的画像。`,
    dimensions: dims,
    techStack: {
      languages: byCat('language'),
      frameworks: byCat('framework'),
      tools: byCat('tool'),
      aiTools: byCat('ai'),
    },
    interests: [...new Set(topProjects.map((p) => p.project))].slice(0, 8),
    workHabits: { activeHours: '见仪表盘 24 小时分布', sessionStyle: '见会话库', questionStyle: '规则版未分析提问风格' },
    collaborationStyle: '配置第三方大模型后可生成协作风格分析。',
    memory: [
      `用户常用 AI 编程工具：${aiTools.join('、') || '未知'}。`,
      `用户的主要技术栈（规则识别）：${[...byCat('language'), ...byCat('framework')].join('、') || '未知'}。`,
      ...topProjects.slice(0, 5).map((p) => `用户维护/参与项目：${p.project}（${p.sessions} 个会话）。`),
    ],
    highlights: ['这是本地规则生成的基准画像，配置大模型后点「LLM 深度画像」可获得更准确的评估。'],
  };
  await saveProfile(db, profile, 'local-rules', 'rule');
  return profile;
}

export function normalizeProfile(p: Partial<UserProfile>, kind: string): UserProfile {
  const dims = Array.isArray(p.dimensions)
    ? p.dimensions
        .filter((d) => d && typeof d.name === 'string')
        .map((d) => ({ name: String(d.name), score: clampScore(d.score), evidence: String(d.evidence ?? '') }))
    : [];
  const ts: UserProfile['techStack'] = p.techStack ?? { languages: [], frameworks: [], tools: [], aiTools: [] };
  return {
    nickname: String(p.nickname || 'AI 编程用户'),
    archetype: String(p.archetype || '开发者'),
    summary: String(p.summary || ''),
    dimensions: dims.length ? dims : [{ name: '综合', score: 3, evidence: kind === 'rule' ? '规则生成' : '默认' }],
    techStack: {
      languages: strArr(ts.languages),
      frameworks: strArr(ts.frameworks),
      tools: strArr(ts.tools),
      aiTools: strArr(ts.aiTools),
    },
    interests: strArr(p.interests),
    workHabits: {
      activeHours: String(p.workHabits?.activeHours ?? ''),
      sessionStyle: String(p.workHabits?.sessionStyle ?? ''),
      questionStyle: String(p.workHabits?.questionStyle ?? ''),
    },
    collaborationStyle: String(p.collaborationStyle ?? ''),
    memory: strArr(p.memory),
    highlights: strArr(p.highlights),
  };
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean) : [];
}

function clampScore(v: unknown): number {
  const n = Math.round(Number(v ?? 3));
  return Number.isFinite(n) ? Math.min(5, Math.max(1, n)) : 3;
}

export async function loadProfile(homeDir: string) {
  const db = await initDb(homeDir);
  return getLatestProfile(db);
}

export async function loadLlmConfig(homeDir: string): Promise<LlmConfig | null> {
  const db = await initDb(homeDir);
  const settings = await getSettings(db);
  if (!settings['llm.config']) return null;
  try {
    return JSON.parse(settings['llm.config']) as LlmConfig;
  } catch {
    return null;
  }
}

export async function saveLlmConfig(homeDir: string, cfg: LlmConfig) {
  const db = await initDb(homeDir);
  await saveSetting(db, 'llm.config', JSON.stringify(cfg));
}
