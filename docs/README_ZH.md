# Lumina: All-in-One AI 助手 (RAG + MCP + CLI 智能体)

**`Lumina` 是一款强大的 Obsidian 全能助手插件，它将多 LLM 支持（云端与本地）、终端 CLI 智能体联动（Claude Code、Antigravity、OpenCode、Codex）、零配置 RAG、双向 MCP 集成和自主 AI 代理结合在一起，把您的知识库变成一个完整的 AI 工作空间。**

<p align="center">
  <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/README.md">English</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_KO.md">한국어</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_JA.md">日本語</a> | <b>简体中文</b> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ZH_TW.md">繁體中文</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ES.md">Español</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_DE.md">Deutsch</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_FR.md">Français</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_PT.md">Português</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_RU.md">Русский</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_IT.md">Italiano</a>
</p>

> **多语言环境优化完毕！** 内置的嵌入模型和 UI 已完全针对多语言环境进行了本地化。（随时欢迎提供翻译反馈！）

![alt text](readme.gif)

---

## 主要功能

| 功能 | 描述 |
| :--- | :--- |
| **多 LLM 聊天视图** | 专属的侧边栏，能够理解您笔记的上下文。支持从强大的云端模型到注重隐私的本地 LLM 的各种模型。 |
| **终端 CLI 智能体集成** | 在 Obsidian 侧边栏面板中直接运行官方终端 AI 智能体（Claude Code、Antigravity、OpenCode、Codex），实时查看思考过程，轻松探索与整理笔记。 |
| **零配置 RAG** | 提供 100% 离线的本地嵌入，防止数据泄露。无需复杂配置，即可实时自动对您的库进行索引。 |
| **智能探索 (Smart Discovery)** | 利用语义搜索立即找到与当前正在撰写的笔记高度相关的文档，检测并警告潜在的重复内容，并支持一键向正文插入推荐标签和关联链接。 |
| **内联 AI 快速操作** | 在编辑器中高亮选中文本，即可立即进行总结、翻译或校对，不会打断您的写作流程。 |
| **智能代理模式** | AI 自主规划并执行复杂的任务，如使用多种内置 MCP 工具进行笔记搜索、创建、修改、删除/移动以及在沙盒内执行代码。 |
| **MCP 集成 (客户端与服务端)** | 双向、全栈式集成，让您可以在 Obsidian 内部使用外部工具（客户端），或让外部 AI 与您的笔记进行交互（服务端）。 |

---

## 快速开始

Lumina 根据您的熟练程度提供两种模式。选择适合您的方式！

### 轨道 1：3 步快速上手（推荐初学者）
1. 安装并启用 Lumina。
2. 前往设置 > Lumina，输入从下方获取的**免费 API 密钥（Gemini 或 Groq）**。
   - [获取 Google Gemini API 密钥 (免费)](https://aistudio.google.com/app/apikey)
   - [获取 Groq API 密钥 (免费)](https://console.groq.com/keys)
3. 打开任意笔记并在右侧边栏面板中向 Lumina 提问。就这样！（侧面板中本地 RAG 索引完成后，基于您笔记的对话将立即激活。）

### 轨道 2：掌握代理模式（推荐高级用户）
1. 在设置中连接本地 LLM 或您正在使用的云端 AI。
2. 在聊天中输入 `/mcp` 以激活**智能代理模式**。
3. 可以发布自主任务命令，例如："在我的库中找出本周的所有会议记录，并将它们整理成一个摘要文件。"

> [!IMPORTANT]
> **安全的 API 密钥存储**
> 您输入的所有 API 密钥绝不会以纯文本文件形式保存。它们通过 Obsidian 内置的 `SecretStorage` 进行安全加密并存储在本地，确保您的数据安全无虞。

---

## 详细功能与用法 (点击展开)
<details>
<summary><b>多 LLM 聊天视图 (支持云端与本地)</b></summary>

- **描述:** 通过 Obsidian 内部的专属侧边栏，与各种 AI 模型进行即时对话。完全支持 Gemini 和 Groq 等强大的云端模型，以及确保绝对隐私的**本地 LLM**（Ollama、LM Studio 等）。
- **如何使用:** 点击左侧栏上的聊天图标，或从命令面板执行 `Lumina: Open Chat`。
- **提示:** 在编辑器中高亮选中文本，右键单击并使用上下文菜单，将所选文本作为上下文直接注入聊天中提问！
</details>

<details>
<summary><b>终端 CLI 智能体集成（Claude Code、Antigravity、OpenCode、Codex）</b></summary>

- **功能说明:** 直接在 Obsidian 侧边栏面板中运行终端 AI 智能体，以探索、分析和整理您的库笔记。
- **支持的智能体:** Anthropic **Claude Code**、Google **Antigravity**、**OpenCode**、OpenAI **Codex**。
- **主要功能:**
  - **只读 / 编辑模式切换:** 在聊天工具栏中一键切换 👁️ **只读模式**（阻止修改笔记，安全浏览与分析）与 ✏️ **编辑模式**。
  - **实时思考过程 (Thinking):** 将 CLI 智能体的内部推理过程以可折叠的实时思考块形式呈现。
  - **实时运行状态与修改文件指示:** 实时显示当前正在执行的工具状态，并提供链接徽标以便直接打开智能体修改的文件。
  - **活动笔记与附件自动传递:** 自动将当前打开的活动笔记和附加的图片/文件传递给智能体提示词，实现无缝上下文对话。
  - **外部终端 MCP 配置同步 (可选):** 在您的库中自动生成配置文件（`.claude/mcp.json`、`opencode.json`、`codex.json`），以便在系统终端中直接运行 CLI 时也能调用 Lumina 的 MCP 工具。
- **如何使用:** 在 Lumina 设置 > 连接 (Connections) 选项卡中选择您偏好的 CLI 提供商，配置可执行文件路径，即可在侧边面板直接开始对话。
</details>

<details>
<summary><b>基于 RAG 的聊天与本地嵌入 (绝对隐私)</b></summary>

- **描述:** AI 深入洞察您的知识库。它在对话期间自主搜索相关笔记，并在侧边栏显示相似文档和推荐标签，建立智能的上下文链接。
- **离线安全:** Lumina 的 RAG 系统使用 100% 离线的本地嵌入（内置 `ibm-granite` 多语言嵌入模型）来分析您的笔记。除非选择了云端模型，否则您宝贵的笔记数据绝不会离开您的设备。
- **全自动化:** 无需任何配置！后台索引会在插件启用时悄悄开始，并在修改笔记时实时 (`watch` 模式) 自动同步。
</details>

<details>
<summary><b>智能探索 (Smart Discovery)</b></summary>

- **描述:** 基于 RAG 引擎，在侧边栏面板的"智能探索"选项卡中，一目了然地可视化提供与当前正在撰写的笔记高度相关的信息。
- **主要功能:**
  - **语义搜索:** 超越简单的关键词匹配，分析输入句子的上下文和含义以进行笔记语义搜索。
  - **重复文档检测:** 若库中已存在内容高度相似的文档，将显示警告以防止信息碎片化和重复编写。
  - **推荐标签与关联笔记:** 分析正在撰写的笔记的上下文，实时推荐合适的标签并建议关联的笔记。
  - **一键联通与对话:** 支持一键将推荐的标签或关联笔记作为标签或 Markdown 链接（`[[笔记名称]]`）插入到您的正文中，或将选定的笔记放入暂存区以立即启动 AI 对话。
- **如何使用:** 点击左侧栏上的聊天图标打开侧边栏面板，并切换到顶部的智能探索选项卡。
</details>

<details>
<summary><b>内联编辑器 AI (快速操作)</b></summary>

- **描述:** 在 Markdown 编辑器中即时转换文本，而不会打断您的写作流程。轻松处理选定文本的翻译、总结、语法纠正和详细解释。
- **如何使用:** 高亮选中文本，通过内联弹出菜单或命令面板执行快速操作。*(提示: 在 Obsidian 设置中分配快捷键以实现极速访问！)*
</details>

<details>
<summary><b>智能代理模式</b></summary>

- **描述:** 启用后，LLM 会自主判断并协调多种内置 MCP 工具来执行任务。它可以通过结合笔记搜索、读取、写入、RAG 检索、沙盒代码执行以及每日笔记集成来完成复杂的多步操作。
- **本地 LLM 支持:** 实现了一个专门的解析器，支持基于文本的工具提示，使代理即使在本地 LLM 环境下也能顺利运行，而不仅仅依赖高性能的云端模型。
- **强大的安全性与用户控制 (Human-in-the-Loop):** 文件修改、删除或代码执行等破坏性操作无法由代理单独执行。修改文件时需在编辑器内通过**内联 Diff 审查**选择逐块接受/拒绝，而创建、删除文件或执行代码等敏感操作则需通过聊天面板中的**内联审批卡片**由用户最终批准 (Accept) 后方可安全执行。（默认支持防覆盖自动备份）
- **成本预防与限制:** 默认应用了工具使用次数和追加字符数限制，以防止 AI 故障或无限循环。（用户可随时在高级设置中调整这些限制。）
- **如何使用:** 在聊天中输入 `/mcp` 命令，或使用顶部图标打开快捷弹出窗口并启用"代理模式"。(内部 Lumina 服务器将在需要时自动启动以执行工具。)
</details>

<details>
<summary><b>MCP 集成 (双向客户端与服务端支持)</b></summary>

- **描述:** 通过模型上下文协议 (MCP) 无缝桥接 Obsidian 与更广泛的 AI 生态系统。将 Obsidian 作为一个全能的 AI 枢纽，或将其用作您 AI 的第二大脑！
- **客户端模式 (Obsidian 主导):**
  - 在 Obsidian 内部直接与 AI 互动并进行工作。
  - 连接众多外部 MCP 服务器（GitHub、本地数据库、网络搜索等），将海量数据即时抓取并整理到您的笔记中。
- **服务端模式 (外部 AI 主导):**
  - 提供多个工具，允许外部 AI 助手（Claude、Cursor 等）或代理模式的 AI 直接访问您的库。
  - **网页搜索:** `lumina_web_search` (使用Tavily、Exa、Google等各种搜索引擎进行实时互联网信息搜索，支持智能截断)
  - **读取与搜索:** `read_active_note`, `read_note` (支持行范围 `startLine`/`endLine` 读取), `search_notes` (支持标签过滤), `grep_search` (全库文件正则/文本行搜索), `glob_files` (通配符文件路径匹配，如 `**/*.md`), `list_notes`, `rag_search`, `get_backlinks`, `get_note_metadata`, `list_attachments`, `list_tags`, `query_metadata` 为 AI 提供广泛的上下文。
  - **编写与修改:** `create_note`, `append_to_note`, `replace_note`, `patch_note`, `update_frontmatter`, `save_attachment`, `create_canvas`, `generate_moc`, `auto_link_note` (创建/修改笔记和画布文件、生成 MOC 核心笔记以及保存二进制文件)。
  - **管理与执行:** `open_note` (在编辑器选项卡中即时打开文件/笔记), `delete_note`, `move_note` (移动/重命名), `execute_code`, `run_note_code_block` (在沙盒内执行代码), `run_shell_command` (在桌面操作系统上执行终端 shell 命令), `show_notice` (显示 Obsidian 通知)。
  - **每日笔记:** `read_daily_note`, `append_to_daily_note` (针对今天每日笔记的读写集成)。
  - **外部终端 CLI MCP 配置同步:** 在库中选择性同步配置文件（`.claude/mcp.json`、`opencode.json`、`codex.json`），使外部终端 CLI 也能调用 Lumina 的库工具，提供一致的工作体验。
  - **库安全与用户控制 (Human-in-the-Loop):** 针对敏感操作提供内联审批卡片，文件修改时提供编辑器内联 Diff 审查，并提供防覆盖自动备份和沙盒隔离代码执行。
- **如何使用:** 在插件设置中启用 MCP 功能，并配置客户端/服务端传输方法 (SSE)。
- **注意:** *Lumina 配备了沙盒代码执行、实时内联 Diff 审查与用户审批 (Human-in-the-Loop)、文件修改自动备份（防覆盖保护）以及防止无限循环和失控工具调用的限制等多层安全机制。不过，由于智能体和外部 AI 会直接访问您的库，建议初期先密切关注相关操作。*
</details>

---

## 调试模式与错误报告

通过在设置中的 [附加功能与其他] 选项卡下启用高级设置并切换 [调试模式]，您可以查看插件处理的所有内部数据。（调试日志在下载前不会保存。）

**帮助解决问题的信息:**
- 您的操作系统 (Windows, macOS, Linux) 和 Obsidian 版本。
- 使用的 AI 提供商和模型名称 (例如：OpenAI / gpt-4o, Ollama / llama3)。
- 调试模式下发生错误后下载的日志文件。
> [!IMPORTANT]
> 由于日志文件可能包含聊天记录，请在提交前删除所有敏感信息。
> **[报告错误 (GitHub Issues)](https://github.com/lumina-apps/obsidian-lumina/issues)**

---

## 支持与赞助

此插件 100% 免费分发，并将持续更新。

**[Ko-fi](https://ko-fi.com/luminaapps)**  
**[Ctee](https://ctee.kr/place/luminaapps)**