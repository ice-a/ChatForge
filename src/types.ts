// 统一数据模型：所有工具的原生会话格式都归一化到这里

export type Role = 'user' | 'assistant' | 'system' | 'tool';

export interface ParsedMessage {
  role: Role;
  content: string;
  ts?: number; // epoch ms
  model?: string;
}

export interface ParsedSession {
  nativeId: string;
  title: string;
  project?: string;
  model?: string;
  createdAt: number;
  updatedAt: number;
  messages: ParsedMessage[];
  sourcePath: string;
  tokensIn?: number;
  tokensOut?: number;
}

export interface AdapterContext {
  homeDir: string;
}

export interface ScanResult {
  sessions: ParsedSession[];
  errors: string[];
}

export interface ToolAdapter {
  id: string;
  label: string;
  /** 默认探测路径（绝对路径），找不到则可在设置中手动指定 */
  defaultPaths: (ctx: AdapterContext) => string[];
  /** 该工具默认探测路径的展示说明 */
  pathHint: string;
  scan: (ctx: AdapterContext, customPaths: string[]) => Promise<ScanResult>;
}

// hub 数据库中的会话行
export interface SessionRow {
  id: string;
  tool: string;
  native_id: string;
  project: string | null;
  title: string;
  model: string | null;
  source_path: string;
  created_at: number;
  updated_at: number;
  message_count: number;
  user_message_count: number;
  first_user_text: string | null;
  tokens_in: number;
  tokens_out: number;
  edited: number; // EXISTS 子查询结果 0/1
}

export interface HubMessage {
  role: Role;
  content: string;
  ts?: number;
  model?: string;
  edited?: boolean;
}

// 用户画像（LLM 或规则生成）
export interface UserProfile {
  nickname: string;
  archetype: string;
  summary: string;
  dimensions: { name: string; score: number; evidence: string }[];
  techStack: {
    languages: string[];
    frameworks: string[];
    tools: string[];
    aiTools: string[];
  };
  interests: string[];
  workHabits: {
    activeHours: string;
    sessionStyle: string;
    questionStyle: string;
  };
  collaborationStyle: string;
  memory: string[];
  highlights: string[];
}

export interface LlmConfig {
  protocol: 'openai' | 'anthropic' | 'ollama';
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
}

export interface ToolSourceConfig {
  enabled: boolean;
  customPaths: string; // 分号分隔；空则用默认探测
}

export interface CustomSource {
  id: string;
  name: string;
  path: string;
  format: 'chat-jsonl' | 'claude-jsonl' | 'codex-jsonl' | 'gemini-json' | 'zcode-sqlite' | 'opencode-storage';
}

export interface ScanReportItem {
  toolId: string;
  label: string;
  ok: boolean;
  sessions: number;
  message: string;
  durationMs: number;
}
