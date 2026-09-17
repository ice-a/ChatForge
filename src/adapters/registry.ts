import { fsListDir, fsReadFile, pathJoin } from '../bridge/client';
import type { ParsedMessage, ParsedSession, ScanResult, ToolAdapter } from '../types';
import {
  listFiles,
  normalizeContent,
  projectFromPath,
  querySqliteSafe,
  readFileText,
  truncateTitle,
} from './scan';
import {
  parseChatLoose,
  parseClaudeJsonl,
  parseCodexJsonl,
  parseGeminiJson,
  parseOpencodeStorage,
  parseZcodeRows,
} from './parsers';

/** 各工具原生数据是否存在的探测（供设置页展示状态）。目录与文件都支持。 */
export async function probePaths(paths: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const p of paths) {
    try {
      await fsListDir(p);
      found.push(p);
      continue;
    } catch {
      /* 不是目录，继续按文件探测 */
    }
    try {
      await fsReadFile(p, 1); // 1 字节读取 = 存在性检查
      found.push(p);
    } catch {
      /* 不存在 */
    }
  }
  return found;
}

function splitPaths(custom?: string): string[] {
  return (custom || '')
    .split(/[;；]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

// ============ ZCode ============

const zcode: ToolAdapter = {
  id: 'zcode',
  label: 'ZCode',
  pathHint: '~/.zcode/cli/db/db.sqlite (SQLite)',
  defaultPaths: (ctx) => [ctx.homeDir + '/.zcode/cli/db/db.sqlite'],
  async scan(ctx, customPaths) {
    const errors: string[] = [];
    const dbs = customPaths.length ? customPaths : await probePaths(zcode.defaultPaths(ctx));
    const sessions: ParsedSession[] = [];
    for (const dbPath of dbs) {
      try {
        const res = await querySqliteSafe(dbPath, ctx.homeDir, [
          { key: 'session', sql: 'SELECT id, directory, title, time_created, time_updated FROM session' },
          { key: 'message', sql: 'SELECT id, session_id, sequence, time_created, data FROM message' },
          { key: 'part', sql: 'SELECT message_id, sequence, data FROM part' },
          {
            key: 'model_usage',
            sql: 'SELECT session_id, model_id, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens FROM model_usage GROUP BY session_id, model_id',
          },
        ]);
          sessions.push(...parseZcodeRows({
            session: res.session.rows,
            message: res.message.rows,
            part: res.part.rows,
            model_usage: res.model_usage.rows,
          }));
        } catch (e) {
          errors.push(`${dbPath}: ${(e as Error).message}`);
        }
      }
      return { sessions, errors };
    },
  };

// ============ Claude Code ============

const claude: ToolAdapter = {
  id: 'claude',
  label: 'Claude Code',
  pathHint: '~/.claude/projects/**/*.jsonl',
  defaultPaths: (ctx) => [ctx.homeDir + '/.claude/projects'],
  async scan(ctx, customPaths) {
    const dirs = customPaths.length ? customPaths : await probePaths(claude.defaultPaths(ctx));
    return scanJsonlDirs(dirs, parseClaudeJsonl);
  },
};

// ============ Codex CLI ============

const codex: ToolAdapter = {
  id: 'codex',
  label: 'Codex CLI',
  pathHint: '~/.codex/sessions/**/*.jsonl',
  defaultPaths: (ctx) => [ctx.homeDir + '/.codex/sessions'],
  async scan(ctx, customPaths) {
    const dirs = customPaths.length ? customPaths : await probePaths(codex.defaultPaths(ctx));
    return scanJsonlDirs(dirs, parseCodexJsonl);
  },
};

// ============ Gemini CLI ============

const gemini: ToolAdapter = {
  id: 'gemini',
  label: 'Gemini CLI',
  pathHint: '~/.gemini/tmp/**/chats/*.json',
  defaultPaths: (ctx) => [ctx.homeDir + '/.gemini/tmp'],
  async scan(ctx, customPaths) {
    const dirs = customPaths.length ? customPaths : await probePaths(gemini.defaultPaths(ctx));
    const errors: string[] = [];
    const sessions: ParsedSession[] = [];
    for (const dir of dirs) {
      const files = await listFiles(dir, '.json', 5, 4000);
      for (const f of files) {
        if (!f.path.includes('chats') && !customPaths.length) continue; // 只认 chats 目录
        try {
          const s = parseGeminiJson(await readFileText(f.path), f.path, f.mtimeMs);
          if (s) sessions.push(s);
        } catch (e) {
          errors.push(`${f.path}: ${(e as Error).message}`);
        }
      }
    }
    return { sessions, errors };
  },
};

// ============ Qwen Code ============

const qwen: ToolAdapter = {
  id: 'qwen',
  label: 'Qwen Code',
  pathHint: '~/.qwen/tmp/**/chats/*.json',
  defaultPaths: (ctx) => [ctx.homeDir + '/.qwen/tmp'],
  async scan(ctx, customPaths) {
    const dirs = customPaths.length ? customPaths : await probePaths(qwen.defaultPaths(ctx));
    const errors: string[] = [];
    const sessions: ParsedSession[] = [];
    for (const dir of dirs) {
      const files = await listFiles(dir, '.json', 5, 4000);
      for (const f of files) {
        if (!f.path.includes('chats') && !customPaths.length) continue;
        try {
          const s = parseGeminiJson(await readFileText(f.path), f.path, f.mtimeMs);
          if (s) sessions.push(s);
        } catch (e) {
          errors.push(`${f.path}: ${(e as Error).message}`);
        }
      }
    }
    return { sessions, errors };
  },
};

// ============ OpenCode ============

const opencode: ToolAdapter = {
  id: 'opencode',
  label: 'OpenCode',
  pathHint: '~/.local/share/opencode/storage 或 ~/AppData/Local/opencode/storage',
  defaultPaths: (ctx) => [ctx.homeDir + '/.local/share/opencode/storage', ctx.homeDir + '/AppData/Local/opencode/storage'],
  async scan(ctx, customPaths) {
    const dirs = customPaths.length ? customPaths : await probePaths(opencode.defaultPaths(ctx));
    const errors: string[] = [];
    const sessions: ParsedSession[] = [];
    for (const dir of dirs) {
      const files = await listFiles(dir, '.json', 6, 8000);
      const loaded: { path: string; text: string; mtimeMs: number }[] = [];
      for (const f of files) {
        try {
          loaded.push({ path: f.path, text: await readFileText(f.path, 16 * 1024 * 1024), mtimeMs: f.mtimeMs });
        } catch (e) {
          errors.push(`${f.path}: ${(e as Error).message}`);
        }
      }
      sessions.push(...parseOpencodeStorage(loaded));
    }
    return { sessions, errors };
  },
};

// ============ pi agent ============

const pi: ToolAdapter = {
  id: 'pi',
  label: 'pi',
  pathHint: '~/.pi/agent/sessions/**/*.jsonl',
  defaultPaths: (ctx) => [ctx.homeDir + '/.pi/agent/sessions', ctx.homeDir + '/.pi/sessions'],
  async scan(ctx, customPaths) {
    const dirs = customPaths.length ? customPaths : await probePaths(pi.defaultPaths(ctx));
    return scanJsonlDirs(dirs, parseChatLoose);
  },
};

// ============ mimo / dsh：未知格式，通用启发式 ============

function genericDirAdapter(id: string, label: string, rel: string, hint: string): ToolAdapter {
  return {
    id,
    label,
    pathHint: hint,
    defaultPaths: (ctx) => [ctx.homeDir + rel],
    async scan(ctx, customPaths) {
      const dirs = customPaths.length ? customPaths : await probePaths([ctx.homeDir + rel]);
      const errors: string[] = [];
      const sessions: ParsedSession[] = [];
      for (const dir of dirs) {
        const r1 = await scanJsonlDirs([dir], parseChatLoose);
        sessions.push(...r1.sessions);
        errors.push(...r1.errors);
        // 补扫 .json 单文件（导出的聊天记录）
        const jsonFiles = await listFiles(dir, '.json', 4, 2000);
        for (const f of jsonFiles) {
          try {
            const s = parseGeminiJson(await readFileText(f.path, 32 * 1024 * 1024), f.path, f.mtimeMs);
            if (s) sessions.push(s);
          } catch {
            /* ignore */
          }
        }
      }
      return { sessions, errors };
    },
  };
}

const mimo = genericDirAdapter('mimo', 'mimo', '/.mimo', '~/.mimo（通用格式启发式解析，可在设置中改路径）');
const dsh = genericDirAdapter('dsh', 'dsh', '/.dsh', '~/.dsh（通用格式启发式解析，可在设置中改路径）');

// ============ Cline ============

const cline: ToolAdapter = {
  id: 'cline',
  label: 'Cline',
  pathHint: '~/.cline/data/db/sessions.db + VSCode globalStorage 任务目录',
  defaultPaths: (ctx) => [ctx.homeDir + '/.cline/data/db/sessions.db'],
  async scan(ctx, customPaths) {
    const errors: string[] = [];
    const sessions: ParsedSession[] = [];
    const dbPath = customPaths[0] || (await probePaths([cline.defaultPaths(ctx)[0]]))[0];
    if (dbPath) {
      try {
        const res = await querySqliteSafe(dbPath, ctx.homeDir, [
          {
            key: 'sessions',
            sql: 'SELECT session_id, provider, model, cwd, workspace_root, started_at, ended_at, prompt, transcript_path, messages_path FROM sessions',
          },
        ]);
        for (const row of res.sessions.rows) {
          const msgs: ParsedMessage[] = [];
          for (const key of ['messages_path', 'transcript_path'] as const) {
            const p = row[key] as string | null;
            if (!p) continue;
            try {
              const text = await readFileText(p, 64 * 1024 * 1024);
              const parsed = parseChatLoose(text, p) ?? parseCodexJsonl(text, p) ?? parseClaudeJsonl(text, p);
              if (parsed) msgs.push(...parsed.messages);
              break;
            } catch {
              /* 文件不存在 */
            }
          }
          if (!msgs.length && row.prompt) {
            msgs.push({ role: 'user', content: String(row.prompt) });
          }
          if (!msgs.length) continue;
          const startIso = row.started_at as string | null;
          const endIso = row.ended_at as string | null;
          const created = startIso ? Date.parse(startIso) : Date.now();
          sessions.push({
            nativeId: `db:${row.session_id}`,
            title: truncateTitle(String(row.prompt || row.session_id)),
            project: projectFromPath((row.cwd as string) || (row.workspace_root as string)),
            model: (row.model as string) || undefined,
            createdAt: created,
            updatedAt: endIso ? Date.parse(endIso) : created,
            messages: msgs,
            sourcePath: dbPath,
          });
        }
      } catch (e) {
        errors.push(`${dbPath}: ${(e as Error).message}`);
      }
    }
    // VSCode 扩展任务目录（多平台候选）
    const vscodeDirs = customPaths.slice(1).length
      ? customPaths.slice(1)
      : [
          ctx.homeDir + '/AppData/Roaming/Code/User/globalStorage/saoudrizwan.claude-dev/tasks',
          ctx.homeDir + '/Library/Application Support/Code/User/globalStorage/saoudrizwan.claude-dev/tasks',
          ctx.homeDir + '/.config/Code/User/globalStorage/saoudrizwan.claude-dev/tasks',
        ];
    for (const dir of vscodeDirs) {
      const subDirs = await listFiles(dir, '', 1, 2000);
      for (const sd of subDirs.filter((x) => x.path && !x.path.includes('.'))) {
        try {
          const histPath = await pathJoin(sd.path, 'api_conversation_history.json');
          const text = await readFileText(histPath, 64 * 1024 * 1024);
          const parsed = parseClineHistory(text, histPath, sd.mtimeMs);
          if (parsed) sessions.push(parsed);
        } catch {
          /* 没有 api_conversation_history.json */
        }
      }
    }
    return { sessions, errors };
  },
};

function parseClineHistory(text: string, filePath: string, mtimeMs: number): ParsedSession | null {
  let arr: unknown[];
  try {
    arr = JSON.parse(text);
  } catch {
    return null;
  }
  if (!Array.isArray(arr)) return null;
  const messages: ParsedMessage[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const role = o.role as string;
    const content = normalizeContent(o.content);
    if (!role || !content) continue;
    messages.push({ role: role as ParsedMessage['role'], content, ts: extractTsSafe(o.ts) });
  }
  if (!messages.length) return null;
  const firstUser = messages.find((m) => m.role === 'user')?.content ?? '';
  return {
    nativeId: `vscode:${filePath}`,
    title: truncateTitle(firstUser),
    model: messages.find((m) => m.role === 'assistant')?.model,
    createdAt: mtimeMs,
    updatedAt: mtimeMs,
    messages,
    sourcePath: filePath,
  };
}

function extractTsSafe(v: unknown): number | undefined {
  return typeof v === 'number' ? v : undefined;
}

// ============ JSONL 目录通用扫描 ============

async function scanJsonlDirs(
  dirs: string[],
  parse: (text: string, filePath: string, mtimeMs: number) => ParsedSession | null,
): Promise<ScanResult> {
  const errors: string[] = [];
  const sessions: ParsedSession[] = [];
  for (const dir of dirs) {
    const files = await listFiles(dir, '.jsonl', 6, 5000);
    for (const f of files) {
      try {
        const text = await readFileText(f.path);
        const s = parse(text, f.path, f.mtimeMs);
        if (s) sessions.push(s);
      } catch (e) {
        errors.push(`${f.path}: ${(e as Error).message}`);
      }
    }
  }
  return { sessions, errors };
}

// ============ 注册表 ============

export const BUILTIN_ADAPTERS: ToolAdapter[] = [zcode, claude, codex, opencode, gemini, qwen, cline, pi, mimo, dsh];

export function getAdapter(id: string): ToolAdapter | undefined {
  return BUILTIN_ADAPTERS.find((a) => a.id === id);
}

/** 自定义来源 → 临时适配器 */
export function buildCustomAdapter(src: { id: string; name: string; path: string; format: string }): ToolAdapter {
  return {
    id: src.id,
    label: `${src.name}（自定义）`,
    pathHint: src.path,
    defaultPaths: () => [src.path],
    async scan(ctx, _customPaths) {
      const errors: string[] = [];
      const sessions: ParsedSession[] = [];
      const p = src.path;
      try {
        if (src.format === 'zcode-sqlite') {
          const res = await querySqliteSafe(p, ctx.homeDir, [
            { key: 'session', sql: 'SELECT id, directory, title, time_created, time_updated FROM session' },
            { key: 'message', sql: 'SELECT id, session_id, sequence, time_created, data FROM message' },
            { key: 'part', sql: 'SELECT message_id, sequence, data FROM part' },
            {
              key: 'model_usage',
              sql: 'SELECT session_id, model_id, SUM(input_tokens) AS input_tokens, SUM(output_tokens) AS output_tokens FROM model_usage GROUP BY session_id, model_id',
            },
          ]);
          sessions.push(...parseZcodeRows({
            session: res.session.rows,
            message: res.message.rows,
            part: res.part.rows,
            model_usage: res.model_usage.rows,
          }));
        } else if (src.format === 'opencode-storage') {
          const files = await listFiles(p, '.json', 6, 8000);
          const loaded: { path: string; text: string; mtimeMs: number }[] = [];
          for (const f of files) loaded.push({ path: f.path, text: await readFileText(f.path, 16 * 1024 * 1024), mtimeMs: f.mtimeMs });
          sessions.push(...parseOpencodeStorage(loaded));
        } else if (src.format === 'gemini-json') {
          const files = await listFiles(p, '.json', 5, 4000);
          for (const f of files) {
            const s = parseGeminiJson(await readFileText(f.path, 32 * 1024 * 1024), f.path, f.mtimeMs);
            if (s) sessions.push(s);
          }
        } else {
          const parser =
            src.format === 'claude-jsonl' ? parseClaudeJsonl : src.format === 'codex-jsonl' ? parseCodexJsonl : parseChatLoose;
          const r = await scanJsonlDirs([p], parser);
          sessions.push(...r.sessions);
          errors.push(...r.errors);
          // 也可能直接给的是单个文件
          if (p.toLowerCase().endsWith('.jsonl')) {
            try {
              const s = parser(await readFileText(p), p, 0);
              if (s) sessions.push(s);
            } catch (e) {
              errors.push((e as Error).message);
            }
          }
        }
      } catch (e) {
        errors.push(`${p}: ${(e as Error).message}`);
      }
      return { sessions, errors };
    },
  };
}
