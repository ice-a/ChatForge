import { chatLLM, extractJsonLoose } from './llm';
import { loadLlmConfig, loadProfile } from './profile';
import { fsWriteFile, pathJoin } from '../bridge/client';
import { initDb, listSessions } from './db';
import type { UserProfile } from '../types';

export interface DistillOptions {
  memory: string[];
  includeTechStack: boolean;
  includeCollab: boolean;
  sessionEvidence: string[]; // 选中的会话摘录
  nameHint?: string;
}

export interface DistilledSkill {
  name: string;
  description: string;
  content: string; // 完整 SKILL.md（含 frontmatter）
  generatedBy: string;
}

// ---------- 名称与校验 ----------

export function sanitizeSkillName(raw: string): string {
  const slug = (raw || '')
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug || 'user-memory';
}

export function skillNameValid(raw: string): boolean {
  return /^[a-z][a-z0-9-]{0,63}$/.test(raw);
}

// ---------- LLM 蒸馏 ----------

const DISTILL_SYSTEM = `你是"蒸馏大师"：把一位开发者的用户画像、智能体记忆和会话证据，蒸馏成一个**可分享**的 AI 编程助手 skill。

## skill 设计规范（必须严格遵守）
1. 一个 skill 是一个目录 \`<name>/SKILL.md\`；SKILL.md 由 YAML frontmatter + Markdown 正文组成。
2. frontmatter 只需要两个字段：
   - \`name\`：小写中划线（kebab-case），1-64 字符，必须与目录名一致，例如 \`collab-with-user\`。
   - \`description\`：**这是触发信号**，必须同时写清"这个 skill 做什么"和"什么场景该触发"。模型容易欠触发，描述要稍微主动一些：列出用户会提到的关键词/短语，例如"在用户要求编写代码、搭建项目、选择技术栈、或提到 <关键词> 时使用"。
3. 正文写法：
   - 用祈使句（"阅读文件后再修改"、"回答使用中文"），不要用对话口吻。
   - 每条规则在"原因不明显"时解释为什么。
   - 用示例代替抽象规则：如果规定了输出格式，给一个字面示例。
   - 全文控制在 500 行以内；把记忆提炼成可执行的协作规则，**不要整段粘贴会话原始记录**。
   - 内容用中文，专有名词/代码保留英文。
4. 这个 skill 的用途：让**其他人和其他 AI 编程工具**（Claude Code / Codex / OpenCode / Gemini CLI / ZCode 等）装上后，能像用户的长期同事一样理解用户的技术栈、偏好和协作方式。

## 输出要求
只输出一个 JSON 对象，不要输出任何其他文字或代码块标记：
{
  "name": "kebab-case 名称",
  "description": "触发信号式描述（中英混合，含触发短语）",
  "content": "---\\nname: ...\\ndescription: ...\\n---\\n\\n# 正文（Markdown）"
}
content 必须是完整 SKILL.md 文件内容（含 frontmatter），JSON 字符串内的换行用 \\n 转义。`;

export async function distillWithLLM(
  homeDir: string,
  opts: DistillOptions,
  onProgress?: (msg: string) => void,
): Promise<DistilledSkill> {
  const cfg = await loadLlmConfig(homeDir);
  if (!cfg || !cfg.baseUrl || !cfg.model) throw new Error('请先在「设置 → 大模型」中配置第三方大模型');
  const profile = await loadProfile(homeDir);

  onProgress?.('收集蒸馏素材…');
  const facts: string[] = [];
  if (profile) facts.push(...collectProfileFacts(profile.profile, opts));
  facts.push(...opts.memory);

  const user = `## 用户画像与记忆素材
${facts.join('\n') || '（无画像，仅依据会话证据）'}

## 会话证据（用户近期真实提问摘录）
${opts.sessionEvidence.slice(0, 20).map((s) => `- ${s}`).join('\n') || '（未选择会话）'}

请蒸馏出一个 skill，让任何 AI 编程工具装上后都能更懂这位用户。`;

  onProgress?.(`调用 ${cfg.model} 蒸馏…`);
  const reply = await chatLLM(cfg, DISTILL_SYSTEM, user, 8000);
  onProgress?.('解析结果…');
  const parsed = extractJsonLoose(reply.text) as { name?: string; description?: string; content?: string };
  const name = sanitizeSkillName(parsed.name || opts.nameHint || 'user-memory');
  let content = (parsed.content || '').trim();
  if (!content.startsWith('---')) {
    // 缺 frontmatter → 补齐
    content = `---\nname: ${name}\ndescription: ${parsed.description || '用户偏好与协作记忆'}\n---\n\n${content}`;
  }
  return {
    name,
    description: parsed.description || '',
    content,
    generatedBy: reply.model || cfg.model,
  };
}

// ---------- 规则蒸馏（无 LLM） ----------

export async function distillRule(homeDir: string, opts: DistillOptions): Promise<DistilledSkill> {
  const profile = await loadProfile(homeDir);
  const facts = profile ? collectProfileFacts(profile.profile, opts) : [];
  const allMemories = [...facts, ...opts.memory].filter(Boolean);
  const p: UserProfile | undefined = profile?.profile;

  const lines: string[] = [];
  lines.push('---');
  const name = sanitizeSkillName(opts.nameHint || 'user-memory');
  lines.push(`name: ${name}`);
  lines.push(
    'description: 用户画像与协作偏好记忆（由 ChatForge 从本地会话蒸馏）。Use whenever you write code for this user, choose a tech stack, scaffold a project, review code, or need to know the user\'s background and preferences — even if they do not mention preferences explicitly.',
  );
  lines.push('---');
  lines.push('');
  lines.push('# 用户协作偏好与背景');
  lines.push('');
  lines.push('> 本 skill 由 ChatForge 从用户本地 AI 工具会话中蒸馏生成，供各 AI 编程工具加载使用。');
  lines.push('');
  if (p) {
    lines.push(`## 用户背景`);
    lines.push('');
    lines.push(`- 称呼：${p.nickname}`);
    lines.push(`- 类型：${p.archetype}`);
    if (p.summary) lines.push(`- 简介：${p.summary}`);
    lines.push('');
  }
  if (opts.includeTechStack && p) {
    lines.push('## 技术栈偏好');
    lines.push('');
    if (p.techStack.languages.length) lines.push(`- 语言：${p.techStack.languages.join('、')}`);
    if (p.techStack.frameworks.length) lines.push(`- 框架：${p.techStack.frameworks.join('、')}`);
    if (p.techStack.tools.length) lines.push(`- 工具：${p.techStack.tools.join('、')}`);
    if (p.techStack.aiTools.length) lines.push(`- AI：${p.techStack.aiTools.join('、')}`);
    lines.push('- 在没有明确要求时，优先采用上述技术栈；用户明确指定时以用户要求为准。');
    lines.push('');
  }
  lines.push('## 记忆条目');
  lines.push('');
  for (const m of allMemories) lines.push(`- ${m}`);
  lines.push('');
  if (opts.includeCollab && p?.collaborationStyle) {
    lines.push('## 协作方式');
    lines.push('');
    lines.push(p.collaborationStyle);
    lines.push('');
  }
  lines.push('## 使用说明');
  lines.push('');
  lines.push('- 开始任务前先对照上文技术栈与记忆条目，避免重复询问用户已知信息。');
  lines.push('- 与记忆冲突时，以用户本次会话的明确要求为准，并提醒存在差异。');
  if (opts.sessionEvidence.length) {
    lines.push('');
    lines.push('## 用户真实提问示例（帮助理解其表达风格）');
    lines.push('');
    for (const s of opts.sessionEvidence.slice(0, 10)) lines.push(`- ${s}`);
  }
  const description =
    '用户画像与协作偏好记忆（由 ChatForge 从本地会话蒸馏）。Use whenever you write code for this user, choose a tech stack, scaffold a project, review code, or need to know the user\'s background and preferences — even if they do not mention preferences explicitly.';
  return { name, description, content: lines.join('\n'), generatedBy: 'local-rules' };
}

function collectProfileFacts(p: UserProfile, opts: DistillOptions): string[] {
  const out: string[] = [];
  if (p.summary) out.push(`画像总述：${p.nickname}，${p.archetype}。${p.summary}`);
  if (opts.includeTechStack) {
    const ts = [
      ...p.techStack.languages.map((x) => `语言:${x}`),
      ...p.techStack.frameworks.map((x) => `框架:${x}`),
      ...p.techStack.tools.map((x) => `工具:${x}`),
      ...p.techStack.aiTools.map((x) => `AI:${x}`),
    ];
    if (ts.length) out.push(`技术栈：${ts.join('、')}`);
  }
  if (opts.includeCollab && p.collaborationStyle) out.push(`协作风格：${p.collaborationStyle}`);
  if (p.workHabits.activeHours) out.push(`活跃时段：${p.workHabits.activeHours}`);
  return out;
}

// ---------- 导出 / 安装 ----------

/** 写出 skill 目录（分享给别人：整个文件夹拷走即可） */
export async function exportSkill(homeDir: string, name: string, content: string): Promise<string> {
  const dir = await pathJoin(homeDir, 'Downloads', 'chatforge', 'skills', name);
  const file = await pathJoin(dir, 'SKILL.md');
  await fsWriteFile(file, content);
  return dir;
}

export interface InstallTarget {
  id: string;
  label: string;
  dir: (home: string) => string;
}

export const INSTALL_TARGETS: InstallTarget[] = [
  { id: 'agents', label: '~/.agents/skills（跨工具标准位置，推荐）', dir: (h) => h + '/.agents/skills' },
  { id: 'zcode', label: '~/.zcode/skills（ZCode）', dir: (h) => h + '/.zcode/skills' },
  { id: 'claude', label: '~/.claude/skills（Claude Code）', dir: (h) => h + '/.claude/skills' },
];

/** 安装到本机某工具的 skills 目录 */
export async function installSkill(homeDir: string, target: InstallTarget, name: string, content: string): Promise<string> {
  const file = await pathJoin(target.dir(homeDir), name, 'SKILL.md');
  await fsWriteFile(file, content);
  return file;
}

/** 会话证据抽样（供蒸馏页选择） */
export async function listEvidence(homeDir: string) {
  const db = await initDb(homeDir);
  return listSessions(db, { limit: 200 });
}
