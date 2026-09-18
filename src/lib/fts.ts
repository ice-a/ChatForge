/**
 * FTS5 全文搜索（trigram 分词器，支持中文子串匹配）。
 * 索引在每次扫描后全量重建；单会话编辑后只重建该会话的索引。
 */
import { sqliteExec, sqliteQuery } from '../bridge/client';

export interface FtsHit {
  session_id: string;
  msg_index: number;
  role: string;
  tool: string;
  snippet: string;
}

/** 建 FTS 表（幂等） */
export async function ensureFts(db: string) {
  await sqliteExec(
    db,
    `CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
      content, session_id UNINDEXED, msg_index UNINDEXED, role UNINDEXED, tool UNINDEXED,
      tokenize='trigram'
    )`,
  );
}

async function insertSession(db: string, sessionId: string, messagesJson: string) {
  let messages: { role: string; content: string }[] = [];
  try {
    messages = JSON.parse(messagesJson || '[]');
  } catch {
    return;
  }
  const params: unknown[] = [];
  const values: string[] = [];
  messages.forEach((m, i) => {
    const content = String(m.content ?? '');
    if (!content.trim()) return;
    values.push('(?,?,?,?,?)');
    params.push(content.slice(0, 100_000), sessionId, i, m.role ?? '', '');
  });
  if (!values.length) return;
  await sqliteExec(
    db,
    `INSERT INTO messages_fts (content, session_id, msg_index, role, tool) VALUES ${values.join(',')}`,
    params,
  );
}

/** 全量重建索引（扫描后调用） */
export async function rebuildFts(db: string) {
  await ensureFts(db);
  await sqliteExec(db, 'DELETE FROM messages_fts');
  const r = await sqliteQuery(db, 'SELECT id, messages_json FROM sessions');
  for (const row of r.rows) {
    await insertSession(db, String(row.id), String(row.messages_json ?? '[]'));
  }
}

/** 单会话索引重建（编辑覆盖层变更后调用，content 用生效内容） */
export async function rebuildFtsSession(db: string, sessionId: string) {
  await ensureFts(db);
  await sqliteExec(db, 'DELETE FROM messages_fts WHERE session_id = ?', [sessionId]);
  const r = await sqliteQuery(db, 'SELECT messages_json FROM sessions WHERE id = ?', [sessionId]);
  if (r.rows.length) await insertSession(db, sessionId, String(r.rows[0].messages_json ?? '[]'));
}

/** 转义用户输入为 FTS 短语查询，避免语法错误 */
export function escapeFtsQuery(q: string): string {
  return `"${q.replace(/"/g, '""')}"`;
}

/** 全文搜索：返回命中消息（带高亮片段） */
export async function searchMessages(db: string, query: string, limit = 60): Promise<FtsHit[]> {
  const q = query.trim();
  if (q.length < 2) return []; // trigram 需 ≥3 字节，中文 2 字即可命中英文需 3 字符
  await ensureFts(db);
  const r = await sqliteQuery(
    db,
    `SELECT session_id, msg_index, role, tool,
            snippet(messages_fts, 0, '「', '」', ' … ', 14) AS snippet
     FROM messages_fts
     WHERE messages_fts MATCH ?
     ORDER BY rank
     LIMIT ${limit}`,
    [escapeFtsQuery(q)],
  );
  return r.rows as unknown as FtsHit[];
}
