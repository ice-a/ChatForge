// 只读探测本机各工具数据库结构，供适配器开发参考。绝不修改原文件。
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const home = os.homedir();

function copyToTemp(dbPath) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dbinspect-'));
  for (const suffix of ['', '-wal', '-shm']) {
    const src = dbPath + suffix;
    if (fs.existsSync(src)) {
      try {
        fs.copyFileSync(src, path.join(tmp, path.basename(dbPath) + suffix));
      } catch {}
    }
  }
  return path.join(tmp, path.basename(dbPath));
}

function trunc(v, n = 400) {
  if (typeof v === 'string') return v.length > n ? v.slice(0, n) + `…(${v.length} chars)` : v;
  if (v === null || v === undefined) return v;
  if (typeof v === 'object') return trunc(JSON.stringify(v), n);
  return v;
}

function inspectDb(db, label, maxRows = 2) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
  console.log(`\n########## ${label} tables: ${tables.map((t) => t.name).join(', ')}`);
  for (const t of tables) {
    try {
      const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE name=?").get(t.name);
      console.log(`\n== ${t.name} ==`);
      console.log((ddl?.sql || '').slice(0, 900));
      const cnt = db.prepare(`SELECT COUNT(*) c FROM "${t.name}"`).get();
      console.log(`rows: ${cnt.c}`);
      const rows = db.prepare(`SELECT * FROM "${t.name}" LIMIT ?`).all(maxRows);
      for (const r of rows) console.log('  ' + JSON.stringify(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, trunc(v, 300)]))).slice(0, 800));
    } catch (e) {
      console.log(`  ERR ${e.message}`);
    }
  }
}

function dumpDb(dbPath, label) {
  if (!fs.existsSync(dbPath)) {
    console.log(`\n########## ${label} MISSING: ${dbPath}`);
    return;
  }
  console.log(`\n########## ${label} ${dbPath}`);
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    inspectDb(db, label);
    db.close();
  } catch (e) {
    console.log(`readonly open failed: ${e.message} → copy to temp`);
    const tmp = copyToTemp(dbPath);
    const db = new DatabaseSync(tmp);
    inspectDb(db, label);
    db.close();
  }
}

// 1. ZCode CLI
dumpDb(path.join(home, '.zcode/cli/db/db.sqlite'), 'ZCODE-CLI');

// 2. Cline
dumpDb(path.join(home, '.cline/data/db/sessions.db'), 'CLINE');

// 3. rollout jsonl 文件头
const rolloutDir = path.join(home, '.zcode/cli/rollout');
if (fs.existsSync(rolloutDir)) {
  for (const f of fs.readdirSync(rolloutDir).slice(0, 2)) {
    console.log(`\n########## ZCODE-ROLLOUT ${f}`);
    const text = fs.readFileSync(path.join(rolloutDir, f), 'utf8');
    const lines = text.split('\n').filter(Boolean);
    console.log('total lines:', lines.length);
    for (const line of lines.slice(0, 3)) console.log(line.slice(0, 700));
  }
}
