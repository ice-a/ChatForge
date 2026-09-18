/**
 * Token 成本估算：维护一张「模型关键词 → 单价（$/1M tokens）」价格表。
 * 价格为公开牌价的近似值，用户可在设置页自由编辑。
 */
import { getSettings, initDb, saveSetting } from './db';

export interface ModelPrice {
  key: string; // 模型名匹配关键词（大小写不敏感，双向包含即命中）
  input: number; // $ / 1M 输入 tokens
  output: number; // $ / 1M 输出 tokens
}

export const DEFAULT_PRICES: ModelPrice[] = [
  { key: 'GLM-5.3', input: 1.0, output: 4.0 },
  { key: 'GLM-5.3-Flash', input: 0.1, output: 0.4 },
  { key: 'glm-4', input: 0.5, output: 2.0 },
  { key: 'deepseek-chat', input: 0.27, output: 1.1 },
  { key: 'deepseek-reasoner', input: 0.55, output: 2.19 },
  { key: 'qwen-plus', input: 0.4, output: 1.2 },
  { key: 'qwen-max', input: 1.6, output: 6.4 },
  { key: 'qwen2.5', input: 0.2, output: 0.6 },
  { key: 'gpt-4o-mini', input: 0.15, output: 0.6 },
  { key: 'gpt-4o', input: 2.5, output: 10 },
  { key: 'claude-sonnet', input: 3, output: 15 },
  { key: 'claude-opus', input: 15, output: 75 },
  { key: 'claude-haiku', input: 1, output: 5 },
  { key: 'kimi', input: 0.6, output: 2.5 },
  { key: 'gemini-2.5-pro', input: 1.25, output: 10 },
  { key: 'gemini-2.5-flash', input: 0.3, output: 2.5 },
];

export async function loadPrices(homeDir: string): Promise<ModelPrice[]> {
  const db = await initDb(homeDir);
  const settings = await getSettings(db);
  if (!settings['model_prices']) return DEFAULT_PRICES;
  try {
    const parsed = JSON.parse(settings['model_prices']) as ModelPrice[];
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_PRICES;
  } catch {
    return DEFAULT_PRICES;
  }
}

export async function savePrices(homeDir: string, prices: ModelPrice[]) {
  const db = await initDb(homeDir);
  await saveSetting(db, 'model_prices', JSON.stringify(prices));
}

/** 匹配规则：精确 → 忽略大小写精确 → 双向包含（更长的关键词优先，避免 GLM-5.3 抢占 GLM-5.3-Flash） */
export function priceFor(model: string | null | undefined, prices: ModelPrice[]): ModelPrice | null {
  if (!model) return null;
  const m = model.toLowerCase();
  for (const p of prices) {
    if (p.key.toLowerCase() === m) return p;
  }
  const sorted = [...prices].sort((a, b) => b.key.length - a.key.length);
  for (const p of sorted) {
    const k = p.key.toLowerCase();
    if (m.includes(k) || k.includes(m)) return p;
  }
  return null;
}

/** 估算成本（$）；无单价或无 token 数据返回 null */
export function estimateCost(
  model: string | null | undefined,
  tokensIn: number,
  tokensOut: number,
  prices: ModelPrice[],
): number | null {
  if (!tokensIn && !tokensOut) return null;
  const p = priceFor(model, prices);
  if (!p) return null;
  return (tokensIn / 1e6) * p.input + (tokensOut / 1e6) * p.output;
}
