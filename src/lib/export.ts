import { fsListDir, fsWriteFile, pathJoin } from '../bridge/client';
import type { ModelUsage, ToolSummary } from './db';
import { estimateCost, type ModelPrice } from './prices';
import type { UserProfile } from '../types';
import dayjs from 'dayjs';

async function exportDir(homeDir: string): Promise<string> {
  let base = await pathJoin(homeDir, '.ai-session-hub', 'exports');
  try {
    const entries = await fsListDir(homeDir);
    if (entries.some((e) => e.name.toLowerCase() === 'downloads' && e.isDir)) {
      base = await pathJoin(homeDir, 'Downloads', 'chatforge');
    }
  } catch {
    /* 用默认 */
  }
  return base;
}

async function writeExport(homeDir: string, filename: string, content: string): Promise<string> {
  const dir = await exportDir(homeDir);
  const path = await pathJoin(dir, filename);
  const r = await fsWriteFile(path, content);
  return r.path;
}

export function profileToMarkdown(p: UserProfile, meta: { model: string; kind: string; createdAt: number }): string {
  const lines: string[] = [];
  lines.push(`# ${p.nickname}`);
  lines.push('');
  lines.push(`> 类型：${p.archetype} ｜ 生成方式：${meta.kind === 'llm' ? `LLM（${meta.model}）` : '本地规则'} ｜ 生成时间：${dayjs(meta.createdAt).format('YYYY-MM-DD HH:mm')}`);
  lines.push('');
  lines.push(p.summary);
  lines.push('');
  lines.push('## 能力评估');
  lines.push('');
  lines.push('| 维度 | 评分(1-5) | 依据 |');
  lines.push('| --- | --- | --- |');
  for (const d of p.dimensions) lines.push(`| ${d.name} | ${d.score} | ${d.evidence.replace(/\|/g, '\\|')} |`);
  lines.push('');
  lines.push('## 技术栈');
  lines.push('');
  lines.push(`- 编程语言：${p.techStack.languages.join('、') || '—'}`);
  lines.push(`- 框架/库：${p.techStack.frameworks.join('、') || '—'}`);
  lines.push(`- 工具/平台：${p.techStack.tools.join('、') || '—'}`);
  lines.push(`- AI 相关：${p.techStack.aiTools.join('、') || '—'}`);
  lines.push('');
  if (p.interests.length) {
    lines.push('## 关注领域');
    lines.push('');
    for (const i of p.interests) lines.push(`- ${i}`);
    lines.push('');
  }
  lines.push('## 工作习惯');
  lines.push('');
  lines.push(`- 活跃时段：${p.workHabits.activeHours || '—'}`);
  lines.push(`- 会话风格：${p.workHabits.sessionStyle || '—'}`);
  lines.push(`- 提问风格：${p.workHabits.questionStyle || '—'}`);
  lines.push('');
  if (p.collaborationStyle) {
    lines.push('## 与 AI 协作风格');
    lines.push('');
    lines.push(p.collaborationStyle);
    lines.push('');
  }
  if (p.highlights.length) {
    lines.push('## 亮点与建议');
    lines.push('');
    for (const h of p.highlights) lines.push(`- ${h}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function profileToAgentsMd(p: UserProfile): string {
  const lines: string[] = [];
  lines.push('# AGENTS.md（智能体记忆）');
  lines.push('');
  lines.push('> 由 ChatForge（会话锻造厂）从本地会话中提炼，供各类 AI 编程工具（Claude Code / Codex / OpenCode / Gemini CLI / ZCode…）使用。');
  lines.push('');
  lines.push('## 用户背景');
  lines.push('');
  lines.push(`- 称呼：${p.nickname}`);
  lines.push(`- 类型：${p.archetype}`);
  if (p.summary) lines.push(`- 简介：${p.summary}`);
  lines.push('');
  lines.push('## 技术栈');
  lines.push('');
  if (p.techStack.languages.length) lines.push(`- 语言：${p.techStack.languages.join('、')}`);
  if (p.techStack.frameworks.length) lines.push(`- 框架：${p.techStack.frameworks.join('、')}`);
  if (p.techStack.tools.length) lines.push(`- 工具：${p.techStack.tools.join('、')}`);
  if (p.techStack.aiTools.length) lines.push(`- AI：${p.techStack.aiTools.join('、')}`);
  lines.push('');
  lines.push('## 记忆条目');
  lines.push('');
  for (const m of p.memory) lines.push(`- ${m}`);
  lines.push('');
  if (p.collaborationStyle) {
    lines.push('## 协作偏好');
    lines.push('');
    lines.push(p.collaborationStyle);
    lines.push('');
  }
  return lines.join('\n');
}

export function usageToCsv(rows: ModelUsage[], prices?: ModelPrice[]): string {
  const head = prices
    ? '工具,模型,会话数,消息数,输入Token,输出Token,估算成本USD,最近活跃'
    : '工具,模型,会话数,消息数,输入Token,输出Token,最近活跃';
  const body = rows
    .map((r) => {
      const cells: (string | number)[] = [
        r.tool,
        `"${String(r.model).replace(/"/g, '""')}"`,
        r.sessions,
        r.msgs,
        r.tokens_in,
        r.tokens_out,
      ];
      if (prices) {
        const c = estimateCost(r.model, Number(r.tokens_in ?? 0), Number(r.tokens_out ?? 0), prices);
        cells.push(c !== null ? c.toFixed(4) : '');
      }
      cells.push(dayjs(r.last_active).format('YYYY-MM-DD HH:mm'));
      return cells.join(',');
    })
    .join('\n');
  return '\uFEFF' + head + '\n' + body;
}

export function toolSummaryToCsv(rows: ToolSummary[]): string {
  const head = '工具,会话数,消息数,用户消息,输入Token,输出Token,最近活跃';
  const body = rows
    .map((r) => [r.tool, r.sessions, r.msgs, r.user_msgs, r.tokens_in, r.tokens_out, dayjs(r.last_active).format('YYYY-MM-DD HH:mm')].join(','))
    .join('\n');
  return '\uFEFF' + head + '\n' + body;
}

export async function exportText(homeDir: string, filename: string, content: string): Promise<string> {
  return writeExport(homeDir, filename, content);
}
