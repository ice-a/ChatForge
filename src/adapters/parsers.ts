import type { ParsedMessage, ParsedSession } from '../types';
import { extractMessageLoose, extractTs, normalizeContent, projectFromPath, truncateTitle } from './scan';

// ============ Claude Code  (~/.claude/projects/**/*.jsonl) ============

export function parseClaudeJsonl(text: string, filePath: string, mtimeMs = 0): ParsedSession | null {
  const messages: ParsedMessage[] = [];
  let title = '';
  let model: string | undefined;
  let cwd: string | undefined;
  let sessionId = '';
  let firstTs: number | undefined;
  let lastTs: number | undefined;

  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(s);
    } catch {
      continue;
    }
    if (o.type === 'summary' && typeof o.summary === 'string' && !title) {
      title = o.summary;
      continue;
    }
    if (typeof o.sessionId === 'string' && !sessionId) sessionId = o.sessionId;
    if (typeof o.cwd === 'string') cwd = o.cwd as string;
    if (o.isSidechain === true || o.isMeta === true) continue;
    const msg = o.message as Record<string, unknown> | undefined;
    if (!msg || typeof msg !== 'object') continue;
    const role = msg.role as string;
    if (role !== 'user' && role !== 'assistant') continue;
    const content = normalizeContent(msg.content);
    if (!content) continue;
    const ts = extractTs(o.timestamp);
    if (role === 'assistant' && typeof msg.model === 'string') model = msg.model;
    if (ts && (!firstTs || ts < firstTs)) firstTs = ts;
    if (ts && (!lastTs || ts > lastTs)) lastTs = ts;
    if (role === 'assistant' && content.startsWith('[调用工具:')) {
      messages.push({ role: 'tool', content, ts });
      continue;
    }
    messages.push({ role, content, ts, model: role === 'assistant' ? (msg.model as string) : undefined });
  }

  if (!messages.length) return null;
  const firstUser = messages.find((m) => m.role === 'user')?.content ?? '';
  return {
    nativeId: sessionId || filePath,
    title: truncateTitle(title || firstUser),
    project: projectFromPath(cwd),
    model,
    createdAt: firstTs ?? mtimeMs,
    updatedAt: lastTs ?? mtimeMs,
    messages,
    sourcePath: filePath,
  };
}

// ============ Codex CLI  (~/.codex/sessions/**/*.jsonl) ============

export function parseCodexJsonl(text: string, filePath: string, mtimeMs = 0): ParsedSession | null {
  const messages: ParsedMessage[] = [];
  let nativeId = '';
  let cwd: string | undefined;
  let model: string | undefined;
  let firstTs: number | undefined;
  let lastTs: number | undefined;

  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s) continue;
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(s);
    } catch {
      continue;
    }
    const ts = extractTs(o.timestamp);
    if (o.type === 'session_meta') {
      const p = (o.payload ?? {}) as Record<string, unknown>;
      if (typeof p.id === 'string') nativeId = p.id;
      if (typeof p.cwd === 'string') cwd = p.cwd;
      if (typeof p.model === 'string') model = p.model;
      continue;
    }
    if (o.type === 'turn_context') {
      const p = (o.payload ?? {}) as Record<string, unknown>;
      if (typeof p.model === 'string') model = p.model;
      continue;
    }
    if (o.type === 'response_item') {
      const p = (o.payload ?? {}) as Record<string, unknown>;
      if (p.type !== 'message') continue;
      const role = p.role as string;
      if (role !== 'user' && role !== 'assistant') continue;
      const content = normalizeContent(p.content);
      if (!content) continue;
      if (ts) {
        if (!firstTs || ts < firstTs) firstTs = ts;
        if (!lastTs || ts > lastTs) lastTs = ts;
      }
      messages.push({ role, content, ts, model: role === 'assistant' ? model : undefined });
    }
  }

  if (!messages.length) return null;
  const firstUser = messages.find((m) => m.role === 'user')?.content ?? '';
  return {
    nativeId: nativeId || filePath,
    title: truncateTitle(firstUser),
    project: projectFromPath(cwd),
    model,
    createdAt: firstTs ?? mtimeMs,
    updatedAt: lastTs ?? mtimeMs,
    messages,
    sourcePath: filePath,
  };
}

// ============ Gemini / Qwen CLI  (~/.gemini/tmp/**/chats/session-*.json) ============

export function parseGeminiJson(text: string, filePath: string, mtimeMs = 0): ParsedSession | null {
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(text);
  } catch {
    return null;
  }
  const rawMsgs = o.messages as Record<string, unknown>[] | undefined;
  if (!Array.isArray(rawMsgs) || !rawMsgs.length) return null;
  const messages: ParsedMessage[] = [];
  for (const m of rawMsgs) {
    const type = m.type as string;
    const role = type === 'user' ? 'user' : type === 'gemini' || type === 'model' ? 'assistant' : '';
    const content = normalizeContent(m.content ?? m.text);
    if (!role || !content) continue;
    messages.push({ role, content, ts: extractTs(m.timestamp ?? m.ts) });
  }
  if (!messages.length) return null;
  const firstUser = messages.find((m) => m.role === 'user')?.content ?? '';
  const startTs = extractTs(o.startTime ?? o.start_time ?? o.timestamp) ?? mtimeMs;
  return {
    nativeId: (o.sessionId as string) || filePath,
    title: truncateTitle((o.title as string) || firstUser),
    project: undefined,
    model: (o.model as string) || undefined,
    createdAt: startTs,
    updatedAt: mtimeMs || startTs,
    messages,
    sourcePath: filePath,
  };
}

// ============ 通用 JSONL / JSON  (mimo / dsh / pi / 自定义来源) ============

export function parseChatLoose(text: string, filePath: string, mtimeMs = 0): ParsedSession | null {
  const messages: ParsedMessage[] = [];
  let firstTs: number | undefined;
  let lastTs: number | undefined;
  let sessionId = '';

  const consume = (o: Record<string, unknown>) => {
    if (typeof o.sessionId === 'string' && !sessionId) sessionId = o.sessionId;
    if (typeof o.session_id === 'string' && !sessionId) sessionId = o.session_id;
    const e = extractMessageLoose(o);
    if (!e) return;
    if (e.role === 'assistant' && e.content.startsWith('[调用工具:')) {
      messages.push({ role: 'tool', content: e.content, ts: e.ts });
      return;
    }
    if (!['user', 'assistant', 'system', 'tool'].includes(e.role)) return;
    if (e.ts) {
      if (!firstTs || e.ts < firstTs) firstTs = e.ts;
      if (!lastTs || e.ts > lastTs) lastTs = e.ts;
    }
    messages.push({ role: e.role as ParsedMessage['role'], content: e.content, ts: e.ts, model: e.model });
  };

  const trimmed = text.trim();
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (Array.isArray(arr)) {
        for (const item of arr) {
          if (item && typeof item === 'object') consume(item as Record<string, unknown>);
        }
      }
    } catch {
      /* fallthrough */
    }
  }
  if (!messages.length) {
    for (const line of trimmed.split('\n')) {
      const s = line.trim();
      if (!s) continue;
      try {
        consume(JSON.parse(s));
      } catch {
        continue;
      }
    }
  }
  if (!messages.length) return null;
  const firstUser = messages.find((m) => m.role === 'user')?.content ?? '';
  return {
    nativeId: sessionId || filePath,
    title: truncateTitle(firstUser),
    model: messages.find((m) => m.role === 'assistant')?.model,
    createdAt: firstTs ?? mtimeMs,
    updatedAt: lastTs ?? mtimeMs,
    messages,
    sourcePath: filePath,
  };
}

// ============ ZCode CLI  (~/.zcode/cli/db/db.sqlite) ============
// 结构：session / message(data JSON) / part(data JSON) / model_usage(含 token)

export interface ZcodeDbRows {
  session: Record<string, unknown>[];
  message: Record<string, unknown>[];
  part: Record<string, unknown>[];
  model_usage: Record<string, unknown>[];
}

export function parseZcodeRows(rows: ZcodeDbRows): ParsedSession[] {
  // part 按 message 分组
  const partsByMsg = new Map<string, { seq: number; data: Record<string, unknown> }[]>();
  for (const p of rows.part) {
    const mid = p.message_id as string;
    if (!mid) continue;
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(p.data as string);
    } catch {
      continue;
    }
    const arr = partsByMsg.get(mid) ?? [];
    arr.push({ seq: Number(p.sequence ?? 0), data });
    partsByMsg.set(mid, arr);
  }

  // message 按 session 分组
  const msgsBySess = new Map<string, { seq: number; id: string; ts: number; data: Record<string, unknown> }[]>();
  for (const m of rows.message) {
    const sid = m.session_id as string;
    if (!sid) continue;
    let data: Record<string, unknown> = {};
    try {
      data = JSON.parse(m.data as string);
    } catch {
      continue;
    }
    const arr = msgsBySess.get(sid) ?? [];
    arr.push({ seq: Number(m.sequence ?? 0), id: m.id as string, ts: Number(m.time_created ?? 0), data });
    msgsBySess.set(sid, arr);
  }

  // model_usage → 每会话 token + 主模型
  const usageBySess = new Map<string, { tokensIn: number; tokensOut: number; models: Map<string, number> }>();
  for (const u of rows.model_usage ?? []) {
    const sid = u.session_id as string;
    if (!sid) continue;
    const rec = usageBySess.get(sid) ?? { tokensIn: 0, tokensOut: 0, models: new Map<string, number>() };
    rec.tokensIn += Number(u.total_input_tokens ?? u.input_tokens ?? 0);
    rec.tokensOut += Number(u.total_output_tokens ?? u.output_tokens ?? 0);
    const mid = (u.model_id as string) || 'unknown';
    rec.models.set(mid, (rec.models.get(mid) ?? 0) + 1);
    usageBySess.set(sid, rec);
  }

  const out: ParsedSession[] = [];
  for (const s of rows.session) {
    const sid = s.id as string;
    const msgs = (msgsBySess.get(sid) ?? []).sort((a, b) => a.seq - b.seq || a.ts - b.ts);
    if (!msgs.length) continue;
    const messages: ParsedMessage[] = [];
    for (const m of msgs) {
      const role = m.data.role as string;
      if (role !== 'user' && role !== 'assistant') continue;
      const parts = (partsByMsg.get(m.id) ?? []).sort((a, b) => a.seq - b.seq);
      const texts: string[] = [];
      const tools: string[] = [];
      for (const p of parts) {
        if (p.data.type === 'text' && typeof p.data.text === 'string') texts.push(p.data.text);
        else if (p.data.type === 'tool') {
          const tool = (p.data.tool as string) || 'tool';
          const state = (p.data.state ?? {}) as Record<string, unknown>;
          const input = (state.input ?? {}) as Record<string, unknown>;
          const desc = (input.description as string) || (input.command as string) || (input.file_path as string) || '';
          tools.push(`[调用工具: ${tool}]${desc ? ' ' + desc : ''}`.trim());
        }
      }
      const content = texts.join('\n');
      const modelId =
        ((m.data.model as Record<string, unknown> | undefined)?.modelID as string) || undefined;
      if (content) messages.push({ role, content, ts: m.ts, model: role === 'assistant' ? modelId : undefined });
      for (const t of tools) messages.push({ role: 'tool', content: t, ts: m.ts });
    }
    if (!messages.length) continue;
    const usage = usageBySess.get(sid);
    let model = messages.find((m) => m.role === 'assistant')?.model;
    if (!model && usage) model = [...usage.models.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const firstUser = messages.find((m) => m.role === 'user')?.content ?? '';
    const createdAt = Number(s.time_created ?? 0) || (messages[0]?.ts ?? 0);
    const updatedAt = Number(s.time_updated ?? 0) || createdAt;
    out.push({
      nativeId: sid,
      title: truncateTitle((s.title as string) || firstUser),
      project: projectFromPath((s.directory as string) || undefined),
      model,
      createdAt,
      updatedAt,
      messages,
      sourcePath: (s.source_path as string) || 'zcode-cli-db',
      tokensIn: usage?.tokensIn,
      tokensOut: usage?.tokensOut,
    });
  }
  return out;
}

// ============ OpenCode  (~/.local/share/opencode/storage/**) ============

export function parseOpencodeStorage(
  files: { path: string; text: string; mtimeMs: number }[],
): ParsedSession[] {
  const sessions = new Map<string, { title?: string; project?: string; created?: number; updated?: number }>();
  const messages = new Map<string, { sid: string; role: string; model?: string; ts?: number }>();
  const parts = new Map<string, { seq: number; kind: string; text: string; tool?: string }[]>();

  for (const f of files) {
    let o: Record<string, unknown>;
    try {
      o = JSON.parse(f.text);
    } catch {
      continue;
    }
    const id = o.id as string;
    if (typeof id === 'string' && id.startsWith('ses') && (o.time || o.directory || o.title !== undefined)) {
      const time = (o.time ?? {}) as Record<string, unknown>;
      sessions.set(id, {
        title: (o.title as string) || undefined,
        project: projectFromPath((o.directory as string) || (o.path as string)),
        created: extractTs(time.create ?? o.created),
        updated: extractTs(time.update ?? o.updated ?? time.create),
      });
      continue;
    }
    if (typeof id === 'string' && id.startsWith('msg') && o.sessionID && o.role) {
      const time = (o.time ?? {}) as Record<string, unknown>;
      messages.set(id, {
        sid: o.sessionID as string,
        role: o.role as string,
        model: (o.modelID as string) || undefined,
        ts: extractTs(time.create ?? o.created),
      });
      continue;
    }
    const mid = (o.messageID ?? o.message_id) as string | undefined;
    if (mid && o.type) {
      const arr = parts.get(mid) ?? [];
      arr.push({
        seq: Number(o.sequence ?? arr.length),
        kind: o.type as string,
        text: typeof o.text === 'string' ? o.text : '',
        tool: (o.tool as string) || ((o.state as Record<string, unknown>)?.tool as string) || undefined,
      });
      parts.set(mid, arr);
    }
  }

  const msgsBySess = new Map<string, { id: string; ts: number }[]>();
  for (const [id, m] of messages) {
    const arr = msgsBySess.get(m.sid) ?? [];
    arr.push({ id, ts: m.ts ?? 0 });
    msgsBySess.set(m.sid, arr);
  }

  const out: ParsedSession[] = [];
  for (const [sid, meta] of sessions) {
    const msgIds = (msgsBySess.get(sid) ?? []).sort((a, b) => a.ts - b.ts);
    if (!msgIds.length) continue;
    const parsed: ParsedMessage[] = [];
    for (const { id } of msgIds) {
      const m = messages.get(id)!;
      const ps = (parts.get(id) ?? []).sort((a, b) => a.seq - b.seq);
      const texts = ps.filter((p) => p.kind === 'text' && p.text).map((p) => p.text);
      const tools = ps.filter((p) => p.kind === 'tool').map((p) => `[调用工具: ${p.tool || 'tool'}]`);
      if (texts.length) parsed.push({ role: m.role as ParsedMessage['role'], content: texts.join('\n'), ts: m.ts, model: m.model });
      for (const t of tools) parsed.push({ role: 'tool', content: t, ts: m.ts });
    }
    if (!parsed.length) continue;
    const firstUser = parsed.find((m) => m.role === 'user')?.content ?? '';
    out.push({
      nativeId: sid,
      title: truncateTitle(meta.title || firstUser),
      project: meta.project,
      model: parsed.find((m) => m.role === 'assistant')?.model,
      createdAt: meta.created ?? (parsed[0]?.ts ?? 0),
      updatedAt: meta.updated ?? mtimeOf(parsed),
      messages: parsed,
      sourcePath: 'opencode-storage',
    });
  }
  return out;
}

function mtimeOf(messages: ParsedMessage[]): number {
  return messages.reduce((acc, m) => Math.max(acc, m.ts ?? 0), 0);
}
