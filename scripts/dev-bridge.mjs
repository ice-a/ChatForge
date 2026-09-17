/**
 * Node 开发桥 —— 与 src-tauri/src/lib.rs 实现完全相同的 IPC 协议。
 *
 * 用途：本机没有 Rust 工具链时，`pnpm dev:bridge` + `pnpm dev` 即可完整运行/测试应用
 * （前端自动探测：有 Tauri 环境用 Tauri invoke，否则走 http://127.0.0.1:17653）。
 *
 * 仅监听 127.0.0.1，仅供本机开发使用。
 */
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';

const PORT = Number(process.env.BRIDGE_PORT || 17653);
const SKIP_DIRS = new Set(['node_modules', '.git', 'target', 'dist', 'Cache', 'Caches', '.pytest_cache']);

// ---------- 工具 ----------

function toSqlParam(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string' || typeof v === 'bigint') return v;
  return JSON.stringify(v); // 数组/对象存为 JSON 文本
}

function normalizeRowValue(v) {
  if (v instanceof Uint8Array) return `[blob ${v.length}B]`;
  if (typeof v === 'bigint') return Number(v);
  return v;
}

function openDbReadonly(p) {
  const db = new DatabaseSync(p, { readOnly: true });
  try { db.exec('PRAGMA busy_timeout=3000'); } catch { /* ignore */ }
  return db;
}

function openDbWrite(p) {
  const db = new DatabaseSync(p);
  try { db.exec('PRAGMA busy_timeout=3000'); } catch { /* ignore */ }
  return db;
}

function walkDir(dir, ext, maxDepth, maxFiles, depth, out) {
  if (depth > maxDepth || out.length >= maxFiles) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // 无权限/不存在 → 跳过
  }
  for (const e of entries) {
    if (out.length >= maxFiles) return;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walkDir(p, ext, maxDepth, maxFiles, depth + 1, out);
    } else if (e.isFile()) {
      if (ext && !e.name.toLowerCase().endsWith(ext)) continue;
      let size = 0, mtimeMs = 0;
      try { const st = fs.statSync(p); size = st.size; mtimeMs = st.mtimeMs; } catch { /* ignore */ }
      out.push({ path: p, size, mtimeMs });
    }
  }
}

// ---------- 命令实现（与 Rust 版语义一致） ----------

const handlers = {
  async bridge_info() {
    return {
      homeDir: os.homedir(),
      platform: os.platform(),
      mode: 'node',
      appVersion: '0.1.0-dev',
    };
  },

  async path_join({ base, parts = [] }) {
    return path.join(base, ...parts.map(String));
  },

  async fs_list_dir({ path: p }) {
    const entries = await fsp.readdir(p, { withFileTypes: true });
    const out = [];
    for (const e of entries) {
      let size = 0, mtimeMs = 0;
      try {
        const st = fs.statSync(path.join(p, e.name));
        size = st.size; mtimeMs = st.mtimeMs;
      } catch { /* ignore */ }
      out.push({ name: e.name, isDir: e.isDirectory(), size, mtimeMs });
    }
    return out;
  },

  async fs_walk({ dir, ext = '', max_depth = 6, max_files = 4000 }) {
    const out = [];
    walkDir(dir, String(ext).toLowerCase(), Number(max_depth) || 6, Number(max_files) || 4000, 0, out);
    out.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return out;
  },

  async fs_read_file({ path: p, max_bytes = 8 * 1024 * 1024 }) {
    const st = await fsp.stat(p);
    const limit = Math.min(Number(max_bytes) || 8 * 1024 * 1024, st.size);
    const fh = await fsp.open(p, 'r');
    try {
      const buf = Buffer.alloc(limit);
      await fh.read(buf, 0, limit, 0);
      return { text: buf.toString('utf8'), truncated: st.size > limit, size: st.size };
    } finally {
      await fh.close();
    }
  },

  async fs_write_file({ path: p, text }) {
    await fsp.mkdir(path.dirname(p), { recursive: true });
    await fsp.writeFile(p, String(text ?? ''), 'utf8');
    return { path: p, bytes: Buffer.byteLength(String(text ?? ''), 'utf8') };
  },

  async fs_copy({ src, dest }) {
    await fsp.mkdir(path.dirname(dest), { recursive: true });
    // 同时拷贝 -wal/-shm，保证 WAL 数据库拷贝后完整可读
    for (const suffix of ['', '-wal', '-shm']) {
      try {
        await fsp.copyFile(src + suffix, dest + suffix);
      } catch (e) {
        if (suffix === '') throw e;
      }
    }
    return { dest };
  },

  async fs_mkdir({ path: p }) {
    await fsp.mkdir(p, { recursive: true });
    return { path: p };
  },

  async sqlite_query({ path: p, sql, params = [], writable = false }) {
    // writable=true 仅用于我们自己拷贝出来的临时副本（需要执行 WAL 恢复），原始库永远只读
    const db = writable ? openDbWrite(p) : openDbReadonly(p);
    try {
      const stmt = db.prepare(sql);
      const rows = params.length ? stmt.all(...params.map(toSqlParam)) : stmt.all();
      return {
        columns: rows.length ? Object.keys(rows[0]) : [],
        rows: rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, normalizeRowValue(v)]))),
      };
    } finally {
      db.close();
    }
  },

  async sqlite_exec({ path: p, sql, params = [] }) {
    const db = openDbWrite(p);
    try {
      if (params.length) {
        const stmt = db.prepare(sql);
        const info = stmt.run(...params.map(toSqlParam));
        return { changes: Number(info.changes), lastInsertId: Number(info.lastInsertRowid) };
      }
      db.exec(sql);
      return { changes: 0, lastInsertId: 0 };
    } finally {
      db.close();
    }
  },

  async http_post_json({ url, headers = {}, body, timeout_secs = 120 }) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), (Number(timeout_secs) || 120) * 1000);
    try {
      const resp = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body ?? null),
        signal: ctrl.signal,
      });
      const text = await resp.text();
      return { status: resp.status, text };
    } finally {
      clearTimeout(timer);
    }
  },
};

// ---------- HTTP 服务 ----------

const server = http.createServer(async (req, res) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors);
    res.end();
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, mode: 'node' }));
    return;
  }
  const m = req.url?.match(/^\/invoke\/(\w+)$/);
  if (req.method !== 'POST' || !m) {
    res.writeHead(404, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'not found' }));
    return;
  }
  const cmd = m[1];
  const handler = handlers[cmd];
  if (!handler) {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: `unknown command: ${cmd}` }));
    return;
  }
  let body = '';
  for await (const chunk of req) body += chunk;
  let args = {};
  try {
    args = body ? JSON.parse(body) : {};
  } catch {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: 'invalid json body' }));
    return;
  }
  try {
    const data = await handler(args);
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: true, data }));
  } catch (e) {
    res.writeHead(200, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ ok: false, error: e?.message || String(e) }));
  }
});

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[dev-bridge] listening on http://127.0.0.1:${PORT} (mode: node, home: ${os.homedir()})`);
});
