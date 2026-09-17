import { httpPostJson } from '../bridge/client';
import type { LlmConfig } from '../types';

/** 常见第三方大模型 OpenAI 兼容端点预设 */
export const LLM_PRESETS: { label: string; protocol: LlmConfig['protocol']; baseUrl: string; model: string }[] = [
  { label: 'DeepSeek 深度求索', protocol: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
  { label: '通义千问 Qwen（百炼）', protocol: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
  { label: '智谱 GLM', protocol: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4.7' },
  { label: '月之暗面 Kimi', protocol: 'openai', baseUrl: 'https://api.moonshot.cn/v1', model: 'kimi-k2-0905-preview' },
  { label: 'OpenAI', protocol: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  { label: 'Anthropic Claude', protocol: 'anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5' },
  { label: '本地 Ollama', protocol: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1', model: 'qwen2.5:7b' },
  { label: '硅基流动 SiliconFlow', protocol: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
];

function normalizeBase(baseUrl: string): string {
  return (baseUrl || '').trim().replace(/\/+$/, '');
}

export interface LlmReply {
  text: string;
  model: string;
}

/** 走桥接层发 HTTP（Tauri 用 reqwest，开发模式用 Node fetch），避免浏览器 CORS 与密钥暴露问题 */
export async function chatLLM(cfg: LlmConfig, system: string, user: string, maxTokens = 8000): Promise<LlmReply> {
  const base = normalizeBase(cfg.baseUrl);
  if (!base) throw new Error('未配置 BaseURL');
  if (!cfg.model) throw new Error('未配置模型名');
  const temperature = typeof cfg.temperature === 'number' ? cfg.temperature : 0.4;

  if (cfg.protocol === 'anthropic') {
    const resp = await httpPostJson(
      `${base}/messages`,
      {
        'content-type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
      },
      {
        model: cfg.model,
        max_tokens: maxTokens,
        temperature,
        system,
        messages: [{ role: 'user', content: user }],
      },
      300,
    );
    if (resp.status >= 400) throw new Error(`Anthropic API ${resp.status}: ${sliceErr(resp.text)}`);
    const json = JSON.parse(resp.text) as { content?: { type: string; text?: string }[]; model?: string };
    const text = (json.content ?? []).filter((c) => c.type === 'text').map((c) => c.text ?? '').join('');
    return { text, model: json.model ?? cfg.model };
  }

  // openai / ollama（ollama 暴露 OpenAI 兼容端点）
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (cfg.apiKey) headers.authorization = `Bearer ${cfg.apiKey}`;
  const resp = await httpPostJson(
    `${base}/chat/completions`,
    headers,
    {
      model: cfg.model,
      temperature,
      max_tokens: maxTokens,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    },
    300,
  );
  if (resp.status >= 400) throw new Error(`LLM API ${resp.status}: ${sliceErr(resp.text)}`);
  const json = JSON.parse(resp.text) as { choices?: { message?: { content?: string } }[]; model?: string };
  const text = json.choices?.[0]?.message?.content ?? '';
  return { text, model: json.model ?? cfg.model };
}

function sliceErr(text: string): string {
  try {
    const j = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    if (typeof j.error === 'string') return j.error;
    if (j.error?.message) return j.error.message;
    if (j.message) return j.message;
  } catch {
    /* 原样返回截断 */
  }
  return (text || '').slice(0, 300);
}

export async function testLLM(cfg: LlmConfig): Promise<{ ok: boolean; message: string; latencyMs: number }> {
  const started = Date.now();
  try {
    const r = await chatLLM(cfg, '你是连通性测试助手。', '请只回复两个字符：OK', 8);
    const ok = /ok|好|成功/i.test(r.text);
    return { ok, message: ok ? `连接成功（${r.model}）：${r.text.slice(0, 40)}` : `模型返回：${r.text.slice(0, 80)}`, latencyMs: Date.now() - started };
  } catch (e) {
    return { ok: false, message: (e as Error).message, latencyMs: Date.now() - started };
  }
}

/** 从模型输出中稳健地提取 JSON（容忍 ```json 包裹、前后闲话） */
export function extractJsonLoose(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced ? fenced[1] : text).trim();
  try {
    return JSON.parse(candidate);
  } catch {
    /* 继续尝试大括号配平 */
  }
  const start = candidate.indexOf('{');
  if (start < 0) throw new Error('模型输出中未找到 JSON');
  let depth = 0;
  let inStr = false;
  let esc2 = false;
  for (let i = start; i < candidate.length; i++) {
    const ch = candidate[i];
    if (inStr) {
      if (esc2) esc2 = false;
      else if (ch === '\\') esc2 = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return JSON.parse(candidate.slice(start, i + 1));
      }
    }
  }
  throw new Error('JSON 解析失败：模型输出不完整');
}
