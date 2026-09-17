import { fsCopy, fsMkdir, fsReadFile, fsWalk, pathJoin, sqliteQuery, type QueryResult } from '../bridge/client';

/** 读取 SQLite（含正在被写入的 WAL 库）：直接只读失败则拷贝到临时目录再读，绝不修改原文件 */
export async function querySqliteSafe(
  dbPath: string,
  homeDir: string,
  statements: { key: string; sql: string; params?: unknown[] }[],
): Promise<Record<string, QueryResult>> {
  try {
    const out: Record<string, QueryResult> = {};
    for (const st of statements) {
      out[st.key] = await sqliteQuery(dbPath, st.sql, st.params ?? []);
    }
    return out;
  } catch {
    const base = dbPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'db.sqlite';
    const tmpDir = await pathJoin(homeDir, '.ai-session-hub', 'tmp');
    await fsMkdir(tmpDir);
    const stamp = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const tmpPath = await pathJoin(tmpDir, `${base}.${stamp}.sqlite`);
    await fsCopy(dbPath, tmpPath);
    const out: Record<string, QueryResult> = {};
    for (const st of statements) {
      // 副本用可写模式打开：SQLite 需要执行 WAL 恢复（重建 -shm），只读连接做不到
      out[st.key] = await sqliteQuery(tmpPath, st.sql, st.params ?? [], true);
    }
    return out;
  }
}

export async function listFiles(dir: string, ext: string, maxDepth = 6, maxFiles = 4000) {
  try {
    return await fsWalk(dir, ext, maxDepth, maxFiles);
  } catch {
    return []; // 目录不存在 → 该来源跳过
  }
}

export async function readFileText(path: string, maxBytes = 128 * 1024 * 1024) {
  const r = await fsReadFile(path, maxBytes);
  return r.text;
}

export function projectFromPath(p?: string | null): string | undefined {
  if (!p) return undefined;
  const seg = p.replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return seg || undefined;
}

export function extractTs(v: unknown): number | undefined {
  if (typeof v === 'number' && v > 10_000_000_000) return v; // epoch ms
  if (typeof v === 'number' && v > 10_000_000) return Math.round(v * 1000); // epoch s
  if (typeof v === 'string') {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return undefined;
}

/** 把各种 content 形态归一化成纯文本 */
export function normalizeContent(c: unknown): string {
  if (c == null) return '';
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) {
    return c
      .map((part) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object') {
          const o = part as Record<string, unknown>;
          if (typeof o.text === 'string') return o.text as string;
          if (typeof o.content === 'string') return o.content as string;
          if (o.type === 'tool_use' || o.type === 'tool_call') {
            const name = (o.name as string) || 'tool';
            return `\n[调用工具: ${name}]`;
          }
        }
        return '';
      })
      .filter(Boolean)
      .join('\n');
  }
  if (typeof c === 'object') {
    const o = c as Record<string, unknown>;
    if (typeof o.text === 'string') return o.text;
  }
  return '';
}

type Extracted = { role: string; content: string; ts?: number; model?: string } | null;

/**
 * 启发式：从任意一行 JSON 里找 (role, content)。
 * 覆盖 claude / codex / pi / 通用 chat jsonl 等常见形态。
 */
export function extractMessageLoose(o: Record<string, unknown>): Extracted {
  if (!o || typeof o !== 'object') return null;

  // claude code: {type:'user'|'assistant', message:{role, content}, timestamp, ...}
  const msg = (o.message ?? o.msg) as Record<string, unknown> | undefined;
  if (msg && typeof msg === 'object') {
    const role = msg.role;
    const content = normalizeContent(msg.content);
    if (typeof role === 'string' && content) {
      return {
        role,
        content,
        ts: extractTs(o.timestamp ?? o.time_created ?? msg.timestamp),
        model: (msg.model as string) || undefined,
      };
    }
  }

  // codex: {type:'response_item', payload:{type:'message', role, content}}
  const payload = o.payload as Record<string, unknown> | undefined;
  if (payload && typeof payload === 'object' && (payload.type === 'message' || payload.role)) {
    const role = payload.role;
    const content = normalizeContent(payload.content);
    if (typeof role === 'string' && content) {
      return { role, content, ts: extractTs(o.timestamp ?? payload.timestamp) };
    }
  }

  // 通用: {role, content} / {type:'user'|'assistant'|'gemini', content} / {role, text}
  const role =
    (typeof o.role === 'string' && o.role) ||
    (o.type === 'user' ? 'user' : o.type === 'assistant' || o.type === 'gemini' || o.type === 'model' ? 'assistant' : '') ||
    '';
  if (!role) return null;
  const content = normalizeContent(o.content) || normalizeContent(o.text);
  if (!content) return null;
  return { role, content, ts: extractTs(o.timestamp ?? o.ts ?? o.time ?? o.created_at) };
}

export function truncateTitle(s: string, n = 60): string {
  const t = s.replace(/\s+/g, ' ').trim();
  return t.length > n ? t.slice(0, n) + '…' : t || '(无标题)';
}

export function nowMs(): number {
  return Date.now();
}
