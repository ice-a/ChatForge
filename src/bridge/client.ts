/**
 * Bridge 客户端 —— 统一 IPC 入口。
 *  - Tauri 环境：走 @tauri-apps/api invoke（Rust 实现，见 src-tauri/src/lib.rs）
 *  - 浏览器开发环境：走 Node 开发桥（scripts/dev-bridge.mjs）
 * 两端实现完全相同的命令协议。
 */
import { invoke as tauriInvoke } from '@tauri-apps/api/core';

const BRIDGE_URL_KEY = 'aisessionhub.bridgeUrl';
const DEFAULT_BRIDGE_URL = 'http://127.0.0.1:17653';

export function getBridgeUrl(): string {
  return localStorage.getItem(BRIDGE_URL_KEY) || DEFAULT_BRIDGE_URL;
}

export function setBridgeUrl(url: string) {
  localStorage.setItem(BRIDGE_URL_KEY, url.replace(/\/$/, ''));
}

export const isTauri = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export type BridgeMode = 'tauri' | 'node' | 'offline';

export interface BridgeInfo {
  homeDir: string;
  platform: string;
  mode: string;
  appVersion: string;
}

async function httpInvoke<T>(cmd: string, args: Record<string, unknown>): Promise<T> {
  const resp = await fetch(`${getBridgeUrl()}/invoke/${cmd}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(args ?? {}),
  });
  const json = await resp.json();
  if (!json.ok) throw new Error(json.error || `bridge error on ${cmd}`);
  return json.data as T;
}

export async function invoke<T = unknown>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  if (isTauri) return tauriInvoke<T>(cmd, args);
  return httpInvoke<T>(cmd, args);
}

// ---------- 命令封装 ----------

export async function getBridgeInfo(): Promise<BridgeInfo> {
  return invoke<BridgeInfo>('bridge_info');
}

export function pathJoin(base: string, ...parts: string[]): Promise<string> {
  return invoke<string>('path_join', { base, parts });
}

export interface DirEntry {
  name: string;
  isDir: boolean;
  size: number;
  mtimeMs: number;
}

export function fsListDir(path: string): Promise<DirEntry[]> {
  return invoke<DirEntry[]>('fs_list_dir', { path });
}

export interface WalkEntry {
  path: string;
  size: number;
  mtimeMs: number;
}

export function fsWalk(dir: string, ext: string, maxDepth = 6, maxFiles = 4000): Promise<WalkEntry[]> {
  return invoke<WalkEntry[]>('fs_walk', { dir, ext, max_depth: maxDepth, max_files: maxFiles });
}

export function fsReadFile(path: string, maxBytes = 8 * 1024 * 1024): Promise<{ text: string; truncated: boolean; size: number }> {
  return invoke('fs_read_file', { path, max_bytes: maxBytes });
}

export function fsWriteFile(path: string, text: string): Promise<{ path: string; bytes: number }> {
  return invoke('fs_write_file', { path, text });
}

export function fsCopy(src: string, dest: string): Promise<{ dest: string }> {
  return invoke('fs_copy', { src, dest });
}

export function fsMkdir(path: string): Promise<{ path: string }> {
  return invoke('fs_mkdir', { path });
}

export interface QueryResult {
  columns: string[];
  rows: Record<string, unknown>[];
}

export function sqliteQuery(path: string, sql: string, params: unknown[] = [], writable = false): Promise<QueryResult> {
  return invoke<QueryResult>('sqlite_query', { path, sql, params, writable });
}

export function sqliteExec(path: string, sql: string, params: unknown[] = []): Promise<{ changes: number; lastInsertId: number }> {
  return invoke('sqlite_exec', { path, sql, params });
}

export interface HttpResult {
  status: number;
  text: string;
}

export function httpPostJson(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutSecs = 120,
): Promise<HttpResult> {
  return invoke<HttpResult>('http_post_json', { url, headers, body, timeout_secs: timeoutSecs });
}
