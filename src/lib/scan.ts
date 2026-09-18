import { BUILTIN_ADAPTERS, buildCustomAdapter, probePaths } from '../adapters/registry';
import { rebuildFts } from './fts';
import { getSettings, initDb, saveSetting, upsertSessions, type SessionFilter } from './db';
import type { CustomSource, ScanReportItem } from '../types';

export interface SourceStatus {
  toolId: string;
  label: string;
  pathHint: string;
  enabled: boolean;
  customPaths: string;
  foundPaths: string[];
}

export async function getSourceStatuses(homeDir: string): Promise<SourceStatus[]> {
  const db = await initDb(homeDir);
  const settings = await getSettings(db);
  const out: SourceStatus[] = [];
  for (const a of BUILTIN_ADAPTERS) {
    const enabled = settings[`source.${a.id}.enabled`] !== '0';
    const customPaths = settings[`source.${a.id}.paths`] ?? '';
    const foundPaths = enabled ? await probePaths(a.defaultPaths({ homeDir })) : [];
    out.push({ toolId: a.id, label: a.label, pathHint: a.pathHint, enabled, customPaths, foundPaths });
  }
  return out;
}

export async function getCustomSources(homeDir: string): Promise<CustomSource[]> {
  const db = await initDb(homeDir);
  const settings = await getSettings(db);
  try {
    return JSON.parse(settings['custom_sources'] || '[]') as CustomSource[];
  } catch {
    return [];
  }
}

export async function saveCustomSources(homeDir: string, sources: CustomSource[]) {
  const db = await initDb(homeDir);
  await saveSetting(db, 'custom_sources', JSON.stringify(sources));
}

export interface ScanProgress {
  current: string;
  index: number;
  total: number;
}

/** 全量扫描：逐个来源执行适配器并入库；跳过未启用/路径不存在的工具 */
export async function runScan(
  homeDir: string,
  opts: { only?: string } = {},
  onProgress?: (p: ScanProgress) => void,
): Promise<ScanReportItem[]> {
  const db = await initDb(homeDir);
  const settings = await getSettings(db);
  const sources: { id: string; label: string; paths: (ctx: { homeDir: string }) => string[]; scan: (ctx: { homeDir: string }, p: string[]) => ReturnType<typeof BUILTIN_ADAPTERS[0]['scan']> }[] =
    BUILTIN_ADAPTERS.map((a) => ({ id: a.id, label: a.label, paths: a.defaultPaths, scan: a.scan }));

  for (const cs of await getCustomSources(homeDir)) {
    const ad = buildCustomAdapter(cs);
    sources.push({ id: ad.id, label: ad.label, paths: ad.defaultPaths, scan: ad.scan });
  }

  const report: ScanReportItem[] = [];
  let index = 0;
  for (const src of sources) {
    if (opts.only && src.id !== opts.only) continue;
    const enabled = settings[`source.${src.id}.enabled`] !== '0';
    const customPaths = (settings[`source.${src.id}.paths`] ?? '')
      .split(/[;；]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const started = Date.now();
    onProgress?.({ current: src.label, index: ++index, total: sources.length });
    if (!enabled) {
      report.push({ toolId: src.id, label: src.label, ok: true, sessions: 0, message: '已禁用，跳过', durationMs: 0 });
      continue;
    }
    let resolved = customPaths;
    if (!resolved.length) {
      const found = await probePaths(src.paths({ homeDir }));
      if (!found.length) {
        report.push({
          toolId: src.id, label: src.label, ok: true, sessions: 0,
          message: '未检测到数据（可在设置中手动指定路径），已跳过',
          durationMs: Date.now() - started,
        });
        continue;
      }
    }
    try {
      const { sessions, errors } = await src.scan({ homeDir }, resolved);
      const n = await upsertSessions(db, src.id.replace(/^custom:/, ''), sessions);
      report.push({
        toolId: src.id, label: src.label, ok: true, sessions: n,
        message: errors.length ? `部分失败：${errors[0].slice(0, 160)}` : '完成',
        durationMs: Date.now() - started,
      });
    } catch (e) {
      report.push({
        toolId: src.id, label: src.label, ok: false, sessions: 0,
        message: (e as Error).message || '扫描失败',
        durationMs: Date.now() - started,
      });
    }
  }

  await saveSetting(db, 'last_scan_at', String(Date.now()));
  await saveSetting(db, 'last_scan_report', JSON.stringify(report));
  // 有会话入库时重建全文索引
  if (report.some((r) => r.sessions > 0)) {
    try {
      await rebuildFts(db);
    } catch {
      /* 索引失败不影响扫描结果 */
    }
  }
  return report;
}

export async function getLastScanReport(homeDir: string): Promise<{ at: number; report: ScanReportItem[] }> {
  const db = await initDb(homeDir);
  const settings = await getSettings(db);
  try {
    return {
      at: Number(settings['last_scan_at'] ?? 0),
      report: JSON.parse(settings['last_scan_report'] || '[]') as ScanReportItem[],
    };
  } catch {
    return { at: 0, report: [] };
  }
}

export type { SessionFilter };
