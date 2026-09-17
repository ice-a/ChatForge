/** 无需 LLM 的本地技术栈启发式识别（作为画像的规则版基础） */

const TECH_PATTERNS: { key: RegExp; label: string; category: 'language' | 'framework' | 'tool' | 'ai' }[] = [
  { key: /\bpython\b|python3|pip\b|conda|anaconda/i, label: 'Python', category: 'language' },
  { key: /\btypescript\b|\bts\b/i, label: 'TypeScript', category: 'language' },
  { key: /javascript|\bnode\b|nodejs|npm\b/i, label: 'JavaScript/Node', category: 'language' },
  { key: /\brust\b|cargo\b|rustc/i, label: 'Rust', category: 'language' },
  { key: /\bgo(lang)?\b|golang/i, label: 'Go', category: 'language' },
  { key: /\bjava\b|maven|gradle/i, label: 'Java', category: 'language' },
  { key: /\bc\+\+|cpp\b|g\+\+/i, label: 'C++', category: 'language' },
  { key: /\bc#\b|\.net\b|dotnet/i, label: 'C#/.NET', category: 'language' },
  { key: /\bsql\b|sqlite|mysql|postgres|postgresql/i, label: 'SQL/数据库', category: 'language' },
  { key: /\bphp\b|laravel|composer/i, label: 'PHP', category: 'language' },
  { key: /\bruby\b|rails/i, label: 'Ruby', category: 'language' },
  { key: /\bswift\b|swiftui/i, label: 'Swift', category: 'language' },
  { key: /\bkotlin\b/i, label: 'Kotlin', category: 'language' },
  { key: /\bbash\b|shell|zsh|powershell/i, label: 'Shell', category: 'language' },

  { key: /vue[23]?|nuxt/i, label: 'Vue', category: 'framework' },
  { key: /react|next\.?js|nextjs|umi|remix/i, label: 'React', category: 'framework' },
  { key: /svelte|kit\b/i, label: 'Svelte', category: 'framework' },
  { key: /ant\s?design|antd/i, label: 'Ant Design', category: 'framework' },
  { key: /element[\s-]?plus|element-ui/i, label: 'Element Plus', category: 'framework' },
  { key: /tailwind/i, label: 'Tailwind CSS', category: 'framework' },
  { key: /fastapi|flask|django/i, label: 'Python Web 框架', category: 'framework' },
  { key: /spring|springboot|spring boot/i, label: 'Spring', category: 'framework' },
  { key: /express|koa|nest\.?js|nestjs|hono/i, label: 'Node Web 框架', category: 'framework' },
  { key: /electron|tauri|wails/i, label: 'Electron/Tauri', category: 'framework' },
  { key: /flutter|compose/i, label: 'Flutter', category: 'framework' },
  { key: /pytorch|torch\b|tensorflow|paddle|transformers/i, label: 'AI 框架', category: 'framework' },
  { key: /langchain|llamaindex|rag\b|embedding|向量/i, label: 'LLM 应用/RAG', category: 'framework' },
  { key: /vite|webpack|rollup|esbuild|turbo/i, label: '构建工具', category: 'framework' },
  { key: /uniapp|uni-app|小程序|wechat|微信/i, label: '小程序/跨端', category: 'framework' },

  { key: /\bgit\b|github|gitlab|gitee/i, label: 'Git', category: 'tool' },
  { key: /docker|containerd|podman/i, label: 'Docker', category: 'tool' },
  { key: /kubernetes|k8s|helm|kubectl/i, label: 'Kubernetes', category: 'tool' },
  { key: /nginx|caddy|traefik/i, label: 'Nginx', category: 'tool' },
  { key: /linux|ubuntu|centos|debian|arch\b/i, label: 'Linux', category: 'tool' },
  { key: /windows|powershell|wsl/i, label: 'Windows', category: 'tool' },
  { key: /vscode|visual studio|vs code/i, label: 'VS Code', category: 'tool' },
  { key: /pnpm|yarn|bun\b/i, label: 'pnpm/bun', category: 'tool' },
  { key: /redis|memcache/i, label: 'Redis', category: 'tool' },
  { key: /elasticsearch|meilisearch|milvus|chroma|qdrant|faiss|bm25/i, label: '搜索/向量库', category: 'tool' },
  { key: /github actions|ci\/cd|jenkins|gitlab-ci/i, label: 'CI/CD', category: 'tool' },
  { key: /supabase|firebase|vercel|cloudflare|cdn/i, label: '云服务', category: 'tool' },
  { key: /ollama|vllm|llama\.cpp|ollama/i, label: '本地推理', category: 'ai' },
  { key: /deepseek|qwen|通义|glm|chatglm|智谱|kimi|moonshot|豆包|doubao|claude|gpt|openai|gemini|grok/i, label: '大模型 API', category: 'ai' },
  { key: /mcp|model context protocol/i, label: 'MCP', category: 'ai' },
  { key: /cursor|copilot|cline|roo|windsurf|trae|codebuddy|opencode|aider/i, label: 'AI 编程工具', category: 'ai' },
  { key: /prompt|提示词|system prompt/i, label: 'Prompt 工程', category: 'ai' },
];

export interface TechStat {
  label: string;
  category: 'language' | 'framework' | 'tool' | 'ai';
  hits: number;
}

export function extractTechStats(texts: string[]): TechStat[] {
  const hits = new Map<string, TechStat>();
  for (const t of texts) {
    if (!t) continue;
    for (const p of TECH_PATTERNS) {
      if (p.key.test(t)) {
        const cur = hits.get(p.label) ?? { label: p.label, category: p.category, hits: 0 };
        cur.hits += 1;
        hits.set(p.label, cur);
      }
    }
  }
  return [...hits.values()].sort((a, b) => b.hits - a.hits);
}

const CATEGORY_LABEL: Record<TechStat['category'], string> = {
  language: '编程语言',
  framework: '框架/库',
  tool: '工具/平台',
  ai: 'AI 相关',
};

export function techStatCategoryLabel(c: TechStat['category']): string {
  return CATEGORY_LABEL[c];
}
