/**
 * 本应用自己的数据库（区别于各工具的原始数据）：
 *   <home>/.ai-session-hub/hub.sqlite
 *
 * 设计原则：各工具的原始会话文件永远只读；用户的编辑以「覆盖层」存在
 * edits 表（title 为 index=-1），重新扫描只会刷新 sessions 表的原始内容，
 * 用户编辑永不丢失。
 */
import { fsMkdir, pathJoin, sqliteExec, sqliteQuery } from '../bridge/client';
import type { ParsedSession, SessionRow, HubMessage, UserProfile } from '../types';

let hubPathCache = '';

export async function getHubPath(homeDir: string): Promise<string> {
  if (!hubPathCache) {
    hubPathCache = await pathJoin(homeDir, '.ai-session-hub', 'hub.sqlite');
  }
  return hubPathCache;
}

export async function initDb(homeDir: string): Promise<string> {
  const dir = await pathJoin(homeDir, '.ai-session-hub');
  await fsMkdir(dir);
  const db = await getHubPath(homeDir);
  await sqliteExec(db, 'PRAGMA journal_mode=WAL');
  await sqliteExec(
    db,
    `CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      tool TEXT NOT NULL,
      native_id TEXT,
      project TEXT,
      title TEXT,
      model TEXT,
      source_path TEXT,
      created_at INTEGER DEFAULT 0,
      updated_at INTEGER DEFAULT 0,
      message_count INTEGER DEFAULT 0,
      user_message_count INTEGER DEFAULT 0,
      first_user_text TEXT,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      messages_json TEXT NOT NULL DEFAULT '[]',
      scanned_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_tool ON sessions(tool);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at);
    CREATE TABLE IF NOT EXISTS edits (
      session_id TEXT NOT NULL,
      msg_index INTEGER NOT NULL,
      content TEXT NOT NULL,
      edited_at INTEGER,
      PRIMARY KEY (session_id, msg_index)
    );
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS profiles (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at INTEGER,
      model TEXT,
      kind TEXT DEFAULT 'llm',
      data_json TEXT NOT NULL
    );`,
  );
  return db;
}

// ---------- 会话写入 ----------

export async function upsertSessions(db: string, tool: string, sessions: ParsedSession[]): Promise<number> {
  let n = 0;
  const now = Date.now();
  for (const s of sessions) {
    const id = `${tool}:${s.nativeId}`;
    const userMsgs = s.messages.filter((m) => m.role === 'user');
    const firstUser = userMsgs[0]?.content?.slice(0, 500) ?? null;
    await sqliteExec(
      db,
      `INSERT INTO sessions (id, tool, native_id, project, title, model, source_path, created_at, updated_at,
        message_count, user_message_count, first_user_text, tokens_in, tokens_out, messages_json, scanned_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         project=excluded.project, title=excluded.title, model=excluded.model,
         source_path=excluded.source_path, created_at=excluded.created_at, updated_at=excluded.updated_at,
         message_count=excluded.message_count, user_message_count=excluded.user_message_count,
         first_user_text=excluded.first_user_text, tokens_in=excluded.tokens_in, tokens_out=excluded.tokens_out,
         messages_json=excluded.messages_json, scanned_at=excluded.scanned_at`,
      [
        id, tool, s.nativeId, s.project ?? null, s.title, s.model ?? null, s.sourcePath,
        s.createdAt || now, s.updatedAt || now,
        s.messages.length, userMsgs.length, firstUser,
        Math.round(s.tokensIn ?? 0), Math.round(s.tokensOut ?? 0),
        JSON.stringify(s.messages.map((m) => ({ role: m.role, content: m.content, ts: m.ts, model: m.model }))),
        now,
      ],
    );
    n++;
  }
  return n;
}

// ---------- 查询 ----------

export interface SessionFilter {
  tool?: string;
  search?: string;
  model?: string;
  limit?: number;
}

export async function listSessions(db: string, filter: SessionFilter = {}): Promise<SessionRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.tool && filter.tool !== 'all') {
    where.push('tool = ?');
    params.push(filter.tool);
  }
  if (filter.model && filter.model !== 'all') {
    where.push('model = ?');
    params.push(filter.model);
  }
  if (filter.search) {
    where.push("(title LIKE ? OR first_user_text LIKE ? OR project LIKE ?)");
    const like = `%${filter.search}%`;
    params.push(like, like, like);
  }
  const sql = `SELECT id, tool, native_id, project, title, model, source_path, created_at, updated_at,
      message_count, user_message_count, first_user_text, tokens_in, tokens_out,
      (SELECT COUNT(*) FROM edits e WHERE e.session_id = sessions.id) AS edited
    FROM sessions
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY updated_at DESC
    LIMIT ${Math.min(filter.limit ?? 1000, 5000)}`;
  const r = await sqliteQuery(db, sql, params);
  return r.rows as unknown as SessionRow[];
}

/** 会话详情：原始消息 + 覆盖层合并 */
export async function getSessionDetail(db: string, id: string): Promise<{ row: SessionRow; messages: HubMessage[] } | null> {
  const r = await sqliteQuery(
    db,
    `SELECT id, tool, native_id, project, title, model, source_path, created_at, updated_at,
       message_count, user_message_count, first_user_text, tokens_in, tokens_out, messages_json,
       (SELECT COUNT(*) FROM edits e WHERE e.session_id = sessions.id) AS edited
     FROM sessions WHERE id = ?`,
    [id],
  );
  if (!r.rows.length) return null;
  const row = r.rows[0] as unknown as SessionRow & { messages_json: string };
  const originals = JSON.parse(row.messages_json || '[]') as HubMessage[];
  const edits = await sqliteQuery(db, 'SELECT msg_index, content FROM edits WHERE session_id = ?', [id]);
  const overlay = new Map<number, string>();
  for (const e of edits.rows) overlay.set(Number(e.msg_index), String(e.content));
  const messages = originals.map((m, i) => {
    const ov = overlay.get(i);
    return ov !== undefined ? { ...m, content: ov, edited: true } : m;
  });
  const titleOv = overlay.get(-1);
  const mergedRow: SessionRow = { ...row, title: titleOv ?? row.title };
  return { row: mergedRow, messages };
}

// ---------- 编辑覆盖层 ----------

export async function saveEdit(db: string, sessionId: string, msgIndex: number, content: string) {
  await sqliteExec(
    db,
    `INSERT INTO edits (session_id, msg_index, content, edited_at) VALUES (?,?,?,?)
     ON CONFLICT(session_id, msg_index) DO UPDATE SET content=excluded.content, edited_at=excluded.edited_at`,
    [sessionId, msgIndex, content, Date.now()],
  );
}

export async function resetEdit(db: string, sessionId: string, msgIndex: number) {
  await sqliteExec(db, 'DELETE FROM edits WHERE session_id = ? AND msg_index = ?', [sessionId, msgIndex]);
}

export async function resetSessionEdits(db: string, sessionId: string) {
  await sqliteExec(db, 'DELETE FROM edits WHERE session_id = ?', [sessionId]);
}

// ---------- 设置 ----------

export async function getSettings(db: string): Promise<Record<string, string>> {
  const r = await sqliteQuery(db, "SELECT key, value FROM settings");
  const out: Record<string, string> = {};
  for (const row of r.rows) out[String(row.key)] = String(row.value ?? '');
  return out;
}

export async function saveSetting(db: string, key: string, value: string) {
  await sqliteExec(
    db,
    "INSERT INTO settings (key, value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    [key, value],
  );
}

// ---------- 画像 ----------

export async function saveProfile(db: string, profile: UserProfile, model: string, kind: string) {
  await sqliteExec(db, 'INSERT INTO profiles (created_at, model, kind, data_json) VALUES (?,?,?,?)', [
    Date.now(), model, kind, JSON.stringify(profile),
  ]);
}

export async function getLatestProfile(db: string): Promise<{ profile: UserProfile; model: string; kind: string; createdAt: number } | null> {
  const r = await sqliteQuery(db, 'SELECT created_at, model, kind, data_json FROM profiles ORDER BY id DESC LIMIT 1');
  if (!r.rows.length) return null;
  const row = r.rows[0];
  try {
    return {
      profile: JSON.parse(String(row.data_json)) as UserProfile,
      model: String(row.model ?? ''),
      kind: String(row.kind ?? 'llm'),
      createdAt: Number(row.created_at ?? 0),
    };
  } catch {
    return null;
  }
}

// ---------- 统计 ----------

export interface ToolSummary {
  tool: string;
  sessions: number;
  msgs: number;
  user_msgs: number;
  tokens_in: number;
  tokens_out: number;
  last_active: number;
}

export interface ModelUsage {
  tool: string;
  model: string;
  sessions: number;
  msgs: number;
  tokens_in: number;
  tokens_out: number;
  last_active: number;
}

export async function getToolSummary(db: string): Promise<ToolSummary[]> {
  const r = await sqliteQuery(db, `SELECT tool, COUNT(*) AS sessions, SUM(message_count) AS msgs,
      SUM(user_message_count) AS user_msgs, SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out,
      MAX(updated_at) AS last_active
    FROM sessions GROUP BY tool ORDER BY sessions DESC`);
  return r.rows as unknown as ToolSummary[];
}

export async function getModelUsage(db: string): Promise<ModelUsage[]> {
  const r = await sqliteQuery(db, `SELECT tool, COALESCE(model, '(未记录)') AS model, COUNT(*) AS sessions,
      SUM(message_count) AS msgs, SUM(tokens_in) AS tokens_in, SUM(tokens_out) AS tokens_out,
      MAX(updated_at) AS last_active
    FROM sessions GROUP BY tool, COALESCE(model, '(未记录)') ORDER BY sessions DESC`);
  return r.rows as unknown as ModelUsage[];
}

export async function getDailyTrend(db: string, days = 30): Promise<{ day: string; sessions: number }[]> {
  const r = await sqliteQuery(db, `SELECT date(updated_at/1000, 'unixepoch', 'localtime') AS day, COUNT(*) AS sessions
    FROM sessions WHERE updated_at > ?
    GROUP BY day ORDER BY day ASC`, [Date.now() - days * 86400_000]);
  return r.rows as unknown as { day: string; sessions: number }[];
}

export async function getHourDistribution(db: string): Promise<{ hour: string; sessions: number }[]> {
  const r = await sqliteQuery(db, `SELECT strftime('%H', updated_at/1000, 'unixepoch', 'localtime') AS hour, COUNT(*) AS sessions
    FROM sessions GROUP BY hour ORDER BY hour ASC`);
  return r.rows as unknown as { hour: string; sessions: number }[];
}

export async function getTopProjects(db: string, limit = 15): Promise<{ project: string; sessions: number; msgs: number }[]> {
  const r = await sqliteQuery(db, `SELECT COALESCE(project, '(未知)') AS project, COUNT(*) AS sessions, SUM(message_count) AS msgs
    FROM sessions GROUP BY COALESCE(project, '(未知)') ORDER BY sessions DESC LIMIT ${limit}`);
  return r.rows as unknown as { project: string; sessions: number; msgs: number }[];
}

export async function getTotalCount(db: string): Promise<number> {
  const r = await sqliteQuery(db, 'SELECT COUNT(*) AS c FROM sessions');
  return Number(r.rows[0]?.c ?? 0);
}

export async function clearAllData(db: string) {
  await sqliteExec(db, 'DELETE FROM sessions; DELETE FROM edits; DELETE FROM profiles;');
}

/** LLM 画像构建素材：抽样用户消息 */
export async function sampleUserTexts(db: string, limit = 300, perLen = 220): Promise<string[]> {
  const r = await sqliteQuery(
    db,
    `SELECT first_user_text, tool, project, updated_at FROM sessions ORDER BY updated_at DESC LIMIT ${limit}`,
  );
  return r.rows
    .map((row) => {
      const d = new Date(Number(row.updated_at)).toISOString().slice(0, 10);
      const text = String(row.first_user_text ?? '').replace(/\s+/g, ' ').slice(0, perLen);
      return text ? `[${String(row.tool)}·${d}${row.project ? '·' + String(row.project) : ''}] ${text}` : '';
    })
    .filter(Boolean);
}
