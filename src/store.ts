import { create } from 'zustand';
import { getBridgeInfo, type BridgeInfo, type BridgeMode } from './bridge/client';
import { getLastScanReport } from './lib/scan';
import type { ScanReportItem } from './types';

interface AppState {
  homeDir: string;
  bridgeMode: BridgeMode;
  bridgeVersion: string;
  dataVersion: number; // 扫描/编辑后 +1，各页面据此刷新
  lastScanAt: number;
  lastScanReport: ScanReportItem[];
  initDone: boolean;
  initError: string;
  theme: 'light' | 'dark';

  initData: () => Promise<void>;
  bumpDataVersion: () => void;
  setScanResult: (at: number, report: ScanReportItem[]) => Promise<void>;
  setTheme: (t: 'light' | 'dark') => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  homeDir: '',
  bridgeMode: 'offline',
  bridgeVersion: '',
  dataVersion: 0,
  lastScanAt: 0,
  lastScanReport: [],
  initDone: false,
  initError: '',
  theme: (localStorage.getItem('chatforge.theme') as 'light' | 'dark') || 'light',

  setTheme(t) {
    localStorage.setItem('chatforge.theme', t);
    set({ theme: t });
  },

  async initData() {
    try {
      const info: BridgeInfo = await getBridgeInfo();
      const { at, report } = await getLastScanReport(info.homeDir);
      set({
        homeDir: info.homeDir,
        bridgeMode: (info.mode === 'tauri' ? 'tauri' : 'node') as BridgeMode,
        bridgeVersion: info.appVersion,
        lastScanAt: at,
        lastScanReport: report,
        initDone: true,
      });
    } catch (e) {
      set({ initDone: true, initError: (e as Error).message });
    }
  },

  bumpDataVersion() {
    set({ dataVersion: get().dataVersion + 1 });
  },

  async setScanResult(at, report) {
    set({ lastScanAt: at, lastScanReport: report });
    get().bumpDataVersion();
  },
}));
