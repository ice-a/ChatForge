<div align="center">

# ⚒️ ChatForge · AI 会话锻造厂

**🔥 炼尽千条会话，铸一个更懂你的 AI 分身**

把散落在 ZCode / Claude Code / Codex / OpenCode / Gemini CLI / Qwen / Cline / pi / mimo / dsh …
里的上万条会话，锻造成：**用户画像 · 智能体记忆 · 技术栈图谱 · 可分享的 Skill**

[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-blueviolet)](#-下载安装)
[![Tauri](https://img.shields.io/badge/Tauri-2-FFC131?logo=tauri&logoColor=black)](https://tauri.app)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react)](https://react.dev)
[![SQLite](https://img.shields.io/badge/SQLite-本地存储-003B57?logo=sqlite)](https://sqlite.org)
[![Actions](https://img.shields.io/badge/构建-GitHub%20Actions%20自动发布-2088FF?logo=githubactions)](#-自动发布)

</div>

---

## 为什么叫「锻造厂」？

别的工具帮你**存**会话，ChatForge 帮你**炼**会话——
矿石进炉（原始会话只读提取）→ 淬火锻造（编辑/统计/画像）→ 出炉成器（`AGENTS.md`、Skill、分享给任何人）。
里面的「蒸馏大师」更是把你的记忆直接蒸馏成符合 skill 规范的成品，装进任何 AI 编程工具，让它一上来就像你的老搭档。

## ✨ 功能一览

| 车间 | 能干什么 |
| --- | --- |
| 📊 仪表盘 | 会话/消息/Token 总量、工具占比饼图、模型用量 TOP10、30 天趋势、24 小时活跃分布、**工具×模型动态表格**（排序/筛选/CSV 导出） |
| 🗃️ 会话库 | 按工具/关键词检索；查看完整对话；**编辑任意消息与标题**（覆盖层机制，可单条/整会话还原，原文件永不改动） |
| 👤 用户画像 | 规则版（免配置开箱即用）+ LLM 深度画像：能力雷达、多维评估、技术栈图谱、工作习惯、协作风格、**智能体记忆条目**；导出 Markdown / JSON / `AGENTS.md` / `CLAUDE.md` |
| ⚗️ 蒸馏大师 | 画像 + 记忆 + 会话证据 → **蒸馏成符合 skill 规范的 `SKILL.md`**（kebab-case + 触发式 description），一键分享文件夹 / 安装到 `~/.agents/skills/` 等目录，别人放进自己工具的 skills 目录即用 |
| ⚙️ 设置 | 每个工具独立开关、默认路径展示、**自定义路径**（没装的工具自动跳过）、自定义来源（未知格式目录 + 6 种解析器）、第三方大模型配置与测试连接 |

## 📥 下载安装

推送代码后 GitHub Actions 自动锻造三平台安装包（见下方「自动发布」），在仓库 **Releases** 页面下载：

| 平台 | 产物 |
| --- | --- |
| 🪟 Windows | `ChatForge_*_x64-setup.exe`（NSIS）/ `.msi` |
| 🍎 macOS (Apple Silicon) | `ChatForge_*_aarch64.dmg` |
| 🐧 Linux x64 | `.deb` / `.AppImage` / `.rpm` |

## 🚀 自动发布

- **推送 `master`** → 自动全平台构建，发布 `v*.*.*-build.N` 预发布版本（每次提交一个构建号）
- **推送版本标签** → 发布正式版：

```bash
git tag v0.1.0
git push origin v0.1.0
```

工作流：[.github/workflows/release.yml](.github/workflows/release.yml)（三平台矩阵并行 → 产物汇总到同一个 Release）

## 🧑‍💻 本地开发（无需 Rust）

```bash
pnpm install
pnpm dev:bridge   # 终端 1：Node 开发桥（文件/SQLite/HTTP，与 Rust 桥同协议）
pnpm dev          # 终端 2：前端 http://127.0.0.1:5173
```

打开后：**设置** → 检查会话来源 → 顶部 **「扫描全部来源」** → 仪表盘 / 会话库 / 用户画像 / 蒸馏大师。

## 🔨 本地构建（需 Rust ≥ 1.77）

```bash
# Windows：VS Build Tools（C++ 工作负载）+ Rust
# macOS：xcode-select --install
# Linux：sudo apt install libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf

pnpm install
pnpm tauri build    # 产物：src-tauri/target/release/bundle/
pnpm tauri dev      # 桌面应用模式开发调试
```

## 🗄️ 数据位置

| 内容 | 路径 |
| --- | --- |
| 本应用数据库（会话副本/编辑覆盖层/画像/配置） | `~/.ai-session-hub/hub.sqlite` |
| WAL 读取临时副本 | `~/.ai-session-hub/tmp/`（可随时清空） |
| 导出（画像 / AGENTS.md / CSV / Skill） | `~/Downloads/chatforge/` |
| Skill 安装位置 | `~/.agents/skills/<name>/`（跨工具标准）、`~/.zcode/skills/`、`~/.claude/skills/` |

## 🔌 会话来源（默认探测路径，均可在设置中覆盖）

| 工具 | 路径 | 格式 |
| --- | --- | --- |
| ZCode | `~/.zcode/cli/db/db.sqlite` | SQLite（含 token 统计） |
| Claude Code | `~/.claude/projects/**/*.jsonl` | JSONL |
| Codex CLI | `~/.codex/sessions/**/*.jsonl` | JSONL（rollout） |
| OpenCode | `~/.local/share/opencode/storage`（Win: `~/AppData/Local/opencode/storage`） | storage JSON |
| Gemini CLI | `~/.gemini/tmp/**/chats/*.json` | JSON |
| Qwen Code | `~/.qwen/tmp/**/chats/*.json` | JSON |
| Cline | `~/.cline/data/db/sessions.db` + VSCode globalStorage 任务目录 | SQLite / JSON |
| pi | `~/.pi/agent/sessions/**/*.jsonl` | JSONL（启发式） |
| mimo / dsh | `~/.mimo`、`~/.dsh` | 未知格式 → 通用启发式（建议设置里手动指定路径） |
| 任意来源 | 设置 → 自定义来源 | 6 种解析器可选 |

**新增一个工具支持** = 在 `src/adapters/registry.ts` 加一个 adapter（默认路径 + 解析函数），UI 零改动。

## 🔒 安全设计

- 各工具原始会话文件**永远只读**，编辑走覆盖层，随时还原
- API Key 仅存本机数据库，LLM 请求经本地桥接直连服务商，不经第三方
- 大模型支持：OpenAI 兼容协议（DeepSeek / Qwen / GLM / Kimi / SiliconFlow / OpenAI…）+ Anthropic + 本地 Ollama

## 🏗️ 架构

```
React 18 + AntD 5 + ECharts (src/)
  │  invoke（统一 IPC 协议）
  ├─ Tauri Rust 桥 (src-tauri/src/lib.rs)      ← 生产，pnpm tauri build
  └─ Node 开发桥  (scripts/dev-bridge.mjs)     ← 开发，pnpm dev:bridge
        fs / sqlite(只读 + WAL 副本兜底) / http_post_json
  适配器层 (src/adapters/)：原生格式 → 统一 Session 模型 → hub.sqlite
  画像/蒸馏 (src/lib/)：规则引擎 + LLM
```

---

<div align="center">

**ChatForge** —— 你的每一条会话，都是锻造更好 AI 分身的矿石 ⚒️

</div>
