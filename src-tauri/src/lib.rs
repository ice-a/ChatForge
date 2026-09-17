//! ChatForge · 会话锻造厂 —— Tauri 2 桥接层。
//!
//! 与 `scripts/dev-bridge.mjs`（Node 开发实现）保持完全相同的命令协议：
//! 前端通过 `src/bridge/client.ts` 统一调用。所有对用户各工具原生数据的
//! 读取都是只读的；唯一的写操作发生在本应用自己的数据库 / 导出目录 /
//! 用户明确指定的 skills 安装目录。

use rusqlite::types::{Value as SqlValue, ValueRef};
use rusqlite::{params_from_iter, Connection, OpenFlags};
use serde_json::{json, Map, Value as Json};
use std::path::{Path, PathBuf};
use std::time::Duration;

// ---------- 基础工具 ----------

fn home_dir() -> String {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .unwrap_or_default()
}

async fn run_blocking<T, F>(f: F) -> Result<T, String>
where
    F: FnOnce() -> Result<T, String> + Send + 'static,
    T: Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| e.to_string())?
}

fn mtime_ms(p: &Path) -> u128 {
    p.metadata()
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis())
        .unwrap_or(0)
}

// ---------- 命令 ----------

#[tauri::command]
async fn bridge_info() -> Result<Json, String> {
    Ok(json!({
        "homeDir": home_dir(),
        "platform": std::env::consts::OS,
        "mode": "tauri",
        "appVersion": env!("CARGO_PKG_VERSION"),
    }))
}

#[tauri::command]
async fn path_join(base: String, parts: Vec<String>) -> Result<String, String> {
    let mut p = PathBuf::from(base);
    for part in parts {
        p.push(part);
    }
    Ok(p.to_string_lossy().to_string())
}

#[tauri::command]
async fn fs_list_dir(path: String) -> Result<Vec<Json>, String> {
    run_blocking(move || {
        let mut out = Vec::new();
        for entry in std::fs::read_dir(&path).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let name = entry.file_name().to_string_lossy().to_string();
            let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
            let meta = entry.metadata();
            let size = meta.as_ref().map(|m| m.len()).unwrap_or(0);
            let mtime = meta
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);
            out.push(json!({"name": name, "isDir": is_dir, "size": size, "mtimeMs": mtime}));
        }
        Ok(out)
    })
    .await
}

const SKIP_DIRS: [&str; 7] = ["node_modules", ".git", "target", "dist", "cache", "caches", ".pytest_cache"];

fn walk_dir(dir: &Path, ext: &str, max_depth: u32, max_files: usize, depth: u32, out: &mut Vec<Json>) {
    if depth > max_depth || out.len() >= max_files {
        return;
    }
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        if out.len() >= max_files {
            return;
        }
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_lowercase().to_string();
        let is_dir = entry.file_type().map(|t| t.is_dir()).unwrap_or(false);
        if is_dir {
            if SKIP_DIRS.contains(&name.as_str()) {
                continue;
            }
            walk_dir(&path, ext, max_depth, max_files, depth + 1, out);
        } else if ext.is_empty() || name.ends_with(ext) {
            let size = entry.metadata().map(|m| m.len()).unwrap_or(0);
            out.push(json!({
                "path": path.to_string_lossy(),
                "size": size,
                "mtimeMs": mtime_ms(&path) as u64,
            }));
        }
    }
}

#[tauri::command]
async fn fs_walk(dir: String, ext: String, max_depth: Option<u32>, max_files: Option<u32>) -> Result<Vec<Json>, String> {
    run_blocking(move || {
        let mut out: Vec<Json> = Vec::new();
        let ext = ext.to_lowercase();
        walk_dir(
            Path::new(&dir),
            &ext,
            max_depth.unwrap_or(6),
            max_files.unwrap_or(4000) as usize,
            0,
            &mut out,
        );
        out.sort_by_key(|v| -(v["mtimeMs"].as_u64().unwrap_or(0) as i64));
        Ok(out)
    })
    .await
}

#[tauri::command]
async fn fs_read_file(path: String, max_bytes: Option<i64>) -> Result<Json, String> {
    run_blocking(move || {
        let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
        let size = meta.len() as i64;
        let limit = size.min(max_bytes.unwrap_or(8 * 1024 * 1024)).max(0) as usize;
        use std::io::Read;
        let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; limit];
        file.read_exact(&mut buf).map_err(|e| e.to_string())?;
        Ok(json!({
            "text": String::from_utf8_lossy(&buf),
            "truncated": size as usize > limit,
            "size": size,
        }))
    })
    .await
}

#[tauri::command]
async fn fs_write_file(path: String, text: String) -> Result<Json, String> {
    run_blocking(move || {
        if let Some(parent) = Path::new(&path).parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::write(&path, text.as_bytes()).map_err(|e| e.to_string())?;
        Ok(json!({"path": path, "bytes": text.len()}))
    })
    .await
}

#[tauri::command]
async fn fs_copy(src: String, dest: String) -> Result<Json, String> {
    run_blocking(move || {
        if let Some(parent) = Path::new(&dest).parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        std::fs::copy(&src, &dest).map_err(|e| e.to_string())?;
        // 同时拷贝 -wal/-shm，保证 WAL 数据库副本完整可恢复
        for suffix in ["-wal", "-shm"] {
            let _ = std::fs::copy(format!("{src}{suffix}"), format!("{dest}{suffix}"));
        }
        Ok(json!({"dest": dest}))
    })
    .await
}

#[tauri::command]
async fn fs_mkdir(path: String) -> Result<Json, String> {
    run_blocking(move || {
        std::fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        Ok(json!({"path": path}))
    })
    .await
}

// ---------- SQLite ----------

fn json_to_sql(v: &Json) -> SqlValue {
    match v {
        Json::Null => SqlValue::Null,
        Json::Bool(b) => SqlValue::Integer(if *b { 1 } else { 0 }),
        Json::Number(n) => {
            if let Some(i) = n.as_i64() {
                SqlValue::Integer(i)
            } else if let Some(f) = n.as_f64() {
                SqlValue::Real(f)
            } else {
                SqlValue::Text(n.to_string())
            }
        }
        Json::String(s) => SqlValue::Text(s.clone()),
        other => SqlValue::Text(other.to_string()),
    }
}

fn value_ref_to_json(vr: ValueRef<'_>) -> Json {
    match vr {
        ValueRef::Null => Json::Null,
        ValueRef::Integer(i) => Json::Number(i.into()),
        ValueRef::Real(f) => serde_json::Number::from_f64(f).map(Json::Number).unwrap_or(Json::Null),
        ValueRef::Text(t) => Json::String(String::from_utf8_lossy(t).to_string()),
        ValueRef::Blob(b) => Json::String(format!("[blob {}B]", b.len())),
    }
}

fn open_readonly(path: &str) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_ONLY).map_err(|e| e.to_string())?;
    conn.busy_timeout(Duration::from_millis(3000)).map_err(|e| e.to_string())?;
    Ok(conn)
}

fn open_rw(path: &str) -> Result<Connection, String> {
    let conn = Connection::open_with_flags(path, OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_CREATE)
        .map_err(|e| e.to_string())?;
    conn.busy_timeout(Duration::from_millis(3000)).map_err(|e| e.to_string())?;
    Ok(conn)
}

#[tauri::command]
async fn sqlite_query(path: String, sql: String, params: Vec<Json>, writable: Option<bool>) -> Result<Json, String> {
    run_blocking(move || {
        // writable=true 仅用于本应用拷贝出来的临时副本（需要 WAL 恢复），原始库永远只读
        let conn = if writable.unwrap_or(false) { open_rw(&path)? } else { open_readonly(&path)? };
        let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
        let col_names: Vec<String> = stmt.column_names().iter().map(|s| s.to_string()).collect();
        let sql_values: Vec<SqlValue> = params.iter().map(json_to_sql).collect();
        let mut rows = stmt
            .query(params_from_iter(sql_values.into_iter()))
            .map_err(|e| e.to_string())?;
        let mut out: Vec<Json> = Vec::new();
        while let Some(row) = rows.next().map_err(|e| e.to_string())? {
            let mut obj = Map::new();
            for (i, name) in col_names.iter().enumerate() {
                let vr = row.get_ref(i).map_err(|e| e.to_string())?;
                obj.insert(name.clone(), value_ref_to_json(vr));
            }
            out.push(Json::Object(obj));
        }
        Ok(json!({"columns": col_names, "rows": out}))
    })
    .await
}

#[tauri::command]
async fn sqlite_exec(path: String, sql: String, params: Vec<Json>) -> Result<Json, String> {
    run_blocking(move || {
        let mut conn = open_rw(&path)?;
        if params.is_empty() {
            conn.execute_batch(&sql).map_err(|e| e.to_string())?;
            Ok(json!({
                "changes": conn.changes() as i64,
                "lastInsertId": conn.last_insert_rowid() as i64,
            }))
        } else {
            let sql_values: Vec<SqlValue> = params.iter().map(json_to_sql).collect();
            let n = conn
                .execute(&sql, params_from_iter(sql_values.into_iter()))
                .map_err(|e| e.to_string())?;
            Ok(json!({"changes": n as i64, "lastInsertId": conn.last_insert_rowid() as i64}))
        }
    })
    .await
}

// ---------- HTTP（LLM 调用走本地桥接，避免 CORS 且密钥不出本机） ----------

#[tauri::command]
async fn http_post_json(
    url: String,
    headers: Json,
    body: Json,
    timeout_secs: Option<u64>,
) -> Result<Json, String> {
    let timeout = Duration::from_secs(timeout_secs.unwrap_or(120));
    let client = reqwest::Client::builder()
        .timeout(timeout)
        .build()
        .map_err(|e| e.to_string())?;
    let mut req = client.post(&url);
    if let Some(map) = headers.as_object() {
        for (k, v) in map {
            let val = match v {
                Json::String(s) => s.clone(),
                other => other.to_string(),
            };
            if let (Ok(name), Ok(value)) = (
                reqwest::header::HeaderName::try_from(k.as_str()),
                reqwest::header::HeaderValue::from_str(&val),
            ) {
                req = req.header(name, value);
            }
        }
    }
    let resp = req.json(&body).send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    Ok(json!({"status": status, "text": text}))
}

// ---------- 入口 ----------

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            bridge_info,
            path_join,
            fs_list_dir,
            fs_walk,
            fs_read_file,
            fs_write_file,
            fs_copy,
            fs_mkdir,
            sqlite_query,
            sqlite_exec,
            http_post_json
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
