/**
 * Provider 切换器（对标 cc-switch）：管理各 AI 编程工具的 API 供应商配置，
 * 一键切换前自动备份原文件。所有写入仅限用户明确点击「应用」时发生。
 */
import { fsReadFile, fsWriteFile, pathJoin } from '../bridge/client';
import { getSettings, initDb, saveSetting } from './db';

export interface ProviderPreset {
  id: string;
  name: string;
  baseUrl: string;
  apiKey: string;
  model?: string;
}

export type ProviderTarget = 'claude' | 'codex' | 'gemini';

/** 常见供应商的 Anthropic 兼容端点（Claude Code 直连用），一键填充后只需补 API Key */
export const PROVIDER_QUICK_PRESETS: { label: string; baseUrl: string; model?: string }[] = [
  { label: 'DeepSeek（Anthropic 兼容）', baseUrl: 'https://api.deepseek.com/anthropic', model: 'deepseek-chat' },
  { label: 'Kimi 月之暗面（Anthropic 兼容）', baseUrl: 'https://api.moonshot.cn/anthropic', model: 'kimi-k2-turbo-preview' },
  { label: '智谱 GLM（Anthropic 兼容）', baseUrl: 'https://open.bigmodel.cn/api/anthropic', model: 'glm-4.6' },
  { label: '自定义中转站（自填 BaseURL）', baseUrl: '' },
];

export const TARGET_LABEL: Record<ProviderTarget, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
  gemini: 'Gemini CLI',
};

export async function loadPresets(homeDir: string): Promise<ProviderPreset[]> {
  const db = await initDb(homeDir);
  const settings = await getSettings(db);
  try {
    return JSON.parse(settings['provider.presets'] || '[]') as ProviderPreset[];
  } catch {
    return [];
  }
}

export async function savePresets(homeDir: string, presets: ProviderPreset[]) {
  const db = await initDb(homeDir);
  await saveSetting(db, 'provider.presets', JSON.stringify(presets));
}

function homePath(homeDir: string, ...parts: string[]): Promise<string> {
  return pathJoin(homeDir, ...parts);
}

async function backup(file: string): Promise<string | null> {
  try {
    const { text } = await fsReadFile(file, 16 * 1024 * 1024);
    const backupPath = `${file}.bak-${Date.now()}`;
    await fsWriteFile(backupPath, text);
    return backupPath;
  } catch {
    return null; // 原文件不存在，无需备份
  }
}

export interface ApplyResult {
  ok: boolean;
  message: string;
  backup?: string;
}

// ---------- Claude Code：~/.claude/settings.json 的 env ----------

export async function applyClaude(homeDir: string, preset: ProviderPreset): Promise<ApplyResult> {
  const file = await homePath(homeDir, '.claude', 'settings.json');
  const bak = await backup(file);
  let settings: Record<string, unknown> = {};
  try {
    const { text } = await fsReadFile(file);
    settings = JSON.parse(text);
  } catch {
    settings = {};
  }
  const env = { ...(settings.env as Record<string, unknown> | undefined) };
  env.ANTHROPIC_BASE_URL = preset.baseUrl;
  if (preset.apiKey) env.ANTHROPIC_AUTH_TOKEN = preset.apiKey;
  if (preset.model) env.ANTHROPIC_MODEL = preset.model;
  settings.env = env;
  await fsWriteFile(file, JSON.stringify(settings, null, 2));
  return { ok: true, message: `已写入 ${file}（env.ANTHROPIC_BASE_URL 等）`, backup: bak ?? undefined };
}

// ---------- Codex CLI：auth.json + config.toml ----------

export async function applyCodex(homeDir: string, preset: ProviderPreset): Promise<ApplyResult> {
  const authFile = await homePath(homeDir, '.codex', 'auth.json');
  const configFile = await homePath(homeDir, '.codex', 'config.toml');
  const bakAuth = await backup(authFile);
  let auth: Record<string, unknown> = {};
  try {
    const { text } = await fsReadFile(authFile);
    auth = JSON.parse(text);
  } catch {
    /* 新装 */
  }
  auth.OPENAI_API_KEY = preset.apiKey || null;
  await fsWriteFile(authFile, JSON.stringify(auth, null, 2));

  let config = '';
  try {
    config = (await fsReadFile(configFile)).text;
  } catch {
    config = '';
  }
  const bakConfig = await backup(configFile);
  if (config.trim()) {
    // 替换首个 base_url / model 赋值；不存在时提示手动配置
    if (/^base_url\s*=/m.test(config)) {
      config = config.replace(/^base_url\s*=.*$/m, `base_url = "${preset.baseUrl}"`);
    }
    if (preset.model && /^model\s*=/m.test(config)) {
      config = config.replace(/^model\s*=.*$/m, `model = "${preset.model}"`);
    }
    await fsWriteFile(configFile, config);
  }
  return {
    ok: true,
    message: `已写入 auth.json${config.trim() ? ' 并更新 config.toml' : '（config.toml 不存在或为空，未改动；自定义供应商请手动配置 [model_providers]）'}`,
    backup: bakAuth ?? bakConfig ?? undefined,
  };
}

// ---------- Gemini CLI：~/.gemini/.env ----------

export async function applyGemini(homeDir: string, preset: ProviderPreset): Promise<ApplyResult> {
  const envFile = await homePath(homeDir, '.gemini', '.env');
  const bak = await backup(envFile);
  let lines: string[] = [];
  try {
    lines = (await fsReadFile(envFile)).text.split('\n');
  } catch {
    lines = [];
  }
  const upsert = (key: string, value: string) => {
    const re = new RegExp(`^${key}=`);
    const line = `${key}=${value}`;
    const i = lines.findIndex((l) => re.test(l));
    if (i >= 0) lines[i] = line;
    else lines.push(line);
  };
  upsert('GEMINI_API_KEY', preset.apiKey);
  if (preset.baseUrl) upsert('GOOGLE_GEMINI_BASE_URL', preset.baseUrl);
  await fsWriteFile(envFile, lines.join('\n'));
  return { ok: true, message: `已写入 ${envFile}`, backup: bak ?? undefined };
}

export async function applyProvider(homeDir: string, target: ProviderTarget, preset: ProviderPreset): Promise<ApplyResult> {
  if (target === 'claude') return applyClaude(homeDir, preset);
  if (target === 'codex') return applyCodex(homeDir, preset);
  return applyGemini(homeDir, preset);
}

// ---------- 当前配置探测（只读展示） ----------

export interface CurrentConfig {
  target: ProviderTarget;
  found: boolean;
  baseUrl?: string;
  model?: string;
}

export async function readCurrentConfigs(homeDir: string): Promise<CurrentConfig[]> {
  const out: CurrentConfig[] = [];
  // claude
  try {
    const { text } = await fsReadFile(await homePath(homeDir, '.claude', 'settings.json'));
    const s = JSON.parse(text) as { env?: Record<string, string> };
    out.push({ target: 'claude', found: true, baseUrl: s.env?.ANTHROPIC_BASE_URL, model: s.env?.ANTHROPIC_MODEL });
  } catch {
    out.push({ target: 'claude', found: false });
  }
  // codex
  try {
    const config = (await fsReadFile(await homePath(homeDir, '.codex', 'config.toml'))).text;
    const baseUrl = config.match(/^base_url\s*=\s*"([^"]+)"/m)?.[1];
    const model = config.match(/^model\s*=\s*"([^"]+)"/m)?.[1];
    out.push({ target: 'codex', found: true, baseUrl, model });
  } catch {
    out.push({ target: 'codex', found: false });
  }
  // gemini
  try {
    const envText = (await fsReadFile(await homePath(homeDir, '.gemini', '.env'))).text;
    out.push({
      target: 'gemini',
      found: true,
      baseUrl: envText.match(/^GOOGLE_GEMINI_BASE_URL=(.+)$/m)?.[1]?.trim(),
    });
  } catch {
    out.push({ target: 'gemini', found: false });
  }
  return out;
}
