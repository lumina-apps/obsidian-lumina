# 🚀 Lumina: All-in-One AI 助手 (RAG + MCP + Agent)

**`Lumina` 是一款强大的 Obsidian 全能助手插件，它将多 LLM 支持、零配置 RAG、双向 MCP 集成和自主 AI 代理结合在一起，把您的知识库变成一个完整的 AI 枢纽。**

<p align="center">
  <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/README.md">English</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_KO.md">한국어</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_JA.md">日本語</a> | <b>简体中文</b> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ZH_TW.md">繁體中文</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ES.md">Español</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_DE.md">Deutsch</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_FR.md">Français</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_PT.md">Português</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_RU.md">Русский</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_IT.md">Italiano</a>
</p>

> 🌐 **多语言环境优化完毕！** 内置的嵌入模型和 UI 已完全针对多语言环境进行了本地化。（随时欢迎提供翻译反馈！）

![alt text](readme.gif)

---

## 🌟 主要功能

| 功能 | 描述 |
| :--- | :--- |
| **💬 多 LLM 聊天视图** | 专属的侧边栏，能够理解您笔记的上下文。支持从强大的云端模型到注重隐私的本地 LLM 的各种模型。 |
| **🧠 零配置 RAG** | 提供 100% 离线的本地嵌入，防止数据泄露。无需复杂配置，即可实时自动对您的库进行索引。 |
| **🔗 智能探索 (Smart Discovery)** | 利用语义搜索立即找到与当前正在撰写的笔记高度相关的文档，检测并警告潜在的重复内容，并支持一键向正文插入推荐标签和关联链接。 |
| **⚡ 内联 AI 快速操作** | 在编辑器中高亮选中文本，即可立即进行总结、翻译或校对，不会打断您的写作流程。 |
| **🚀 智能代理模式** | AI 自主规划并执行复杂的任务，如使用 多种内置 MCP 工具进行笔记搜索、创建、修改、删除/移动以及在沙盒内执行代码。 |
| **🔌 MCP 集成 (客户端与服务端)** | 双向、全栈式集成，让您可以在 Obsidian 内部使用外部工具（客户端），或让外部 AI 与您的笔记进行交互（服务端）。 |

---

## ⚡ 快速开始

Lumina 根据您的熟练程度提供两种模式。选择适合您的方式！

### 🟢 轨道 1：3 步快速上手（推荐初学者）
1. 安装并启用 Lumina。
2. 前往设置 > Lumina，输入从下方链接获取的**免费 API 密钥（Gemini 或 Groq）**。
   - 👉 [获取 Google Gemini API 密钥 (免费)](https://aistudio.google.com/app/apikey)
   - 👉 [获取 Groq API 密钥 (免费)](https://console.groq.com/keys)
3. 打开任意笔记并在右侧边栏面板中向 Lumina 提问。就这样！（侧面板中本地 RAG 索引完成后，基于您笔记的对话将立即激活。）

### 🔵 轨道 2：掌握代理模式（推荐高级用户）
1. 在设置中连接本地 LLM 或您正在使用的云端 AI。
2. 在聊天中输入 `/mcp` 以激活**智能代理模式**。
3. 可以发布自主任务命令，例如："在我的库中找出本周的所有会议记录，并将它们整理成一个摘要文件。"

> [!IMPORTANT]
> **🔒 安全的 API 密钥存储**
> 您输入的所有 API 密钥绝不会以纯文本文件形式保存。它们通过 Obsidian 内置的 `SecretStorage` 进行安全加密并存储在本地，确保您的数据安全无虞。

---

## ✨ 详细功能与用法 (点击展开)
<details>
<summary><b>💬 多 LLM 聊天视图 (支持云端与本地)</b></summary>

- **描述:** 通过 Obsidian 内部的专属侧边栏，与各种 AI 模型进行即时对话。完全支持 Gemini 和 Groq 等强大的云端模型，以及确保绝对隐私的**本地 LLM**（Ollama、LM Studio 等）。
- **如何使用:** 点击左侧栏上的 💬 图标，或从命令面板执行 `Lumina: Open Chat`。
- **💡 提示:** 在编辑器中高亮选中文本，右键单击并使用上下文菜单，将所选文本作为上下文直接注入聊天中提问！
</details>

<details>
<summary><b>🧠 基于 RAG 的聊天与本地嵌入 (绝对隐私)</b></summary>

- **描述:** AI 深入洞察您的知识库。它在对话期间自主搜索相关笔记，并在侧边栏显示相似文档和推荐标签，建立智能的上下文链接。
- **离线安全:** Lumina 的 RAG 系统使用 100% 离线的本地嵌入（内置 `ibm-granite` 多语言嵌入模型）来分析您的笔记。除非选择了云端模型，否则您宝贵的笔记数据绝不会离开您的设备。
- **全自动化:** 无需任何配置！后台索引会在插件启用时悄悄开始，并在修改笔记时实时 (`watch` 模式) 自动同步。
</details>

<details>
<summary><b>🔗 智能探索 (Smart Discovery)</b></summary>

- **描述:** 基于 RAG 引擎，在侧边栏面板的“智能探索”选项卡中，一目了然地可视化提供与当前正在撰写的笔记高度相关的信息。
- **主要功能:**
  - **语义搜索:** 超越简单的关键词匹配，分析输入句子的上下文和含义以进行笔记语义搜索。
  - **重复文档检测:** 若库中已存在内容高度相似的文档，将显示警告以防止信息碎片化和重复编写。
  - **推荐标签与关联笔记:** 分析正在撰写的笔记的上下文，实时推荐合适的标签并建议关联的笔记。
  - **一键联通与对话:** 支持一键将推荐的标签或关联笔记作为标签或 Markdown 链接（`[[笔记名称]]`）插入到您的正文中，或将选定的笔记放入暂存区以立即启动 AI 对话。
- **如何使用:** 点击左侧栏上的 💬 图标打开侧边栏面板，并切换到顶部的 🔗（智能探索）选项卡。
</details>

<details>
<summary><b>⚡ 内联编辑器 AI (快速操作)</b></summary>

- **描述:** 在 Markdown 编辑器中即时转换文本，而不会打断您的写作流程。轻松处理选定文本的翻译、总结、语法纠正和详细解释。
- **如何使用:** 高亮选中文本，通过内联弹出菜单或命令面板执行快速操作。*(💡 提示: 在 Obsidian 设置中分配快捷键以实现极速访问！)*
</details>

<details>
<summary><b>🚀 智能代理模式</b></summary>

- **描述:** 启用后，LLM 会自主判断并协调 多种内置 MCP 工具来执行任务。它可以通过结合笔记搜索、读取、写入、RAG 检索、沙盒代码执行以及每日笔记集成来完成复杂的多步操作。
- **本地 LLM 支持:** 实现了一个专门的解析器，支持基于文本的工具提示，使代理即使在本地 LLM 环境下也能顺利运行，而不仅仅依赖高性能的云端模型。
- **强大的安全与用户控制 (Human-in-the-Loop):** 内容修改、文件删除或代码执行等破坏性操作不能由代理单独处理。它们只有在通过 UI（差异查看器和任务警告模态框）提示用户并获得最终批准 (Accept) 后，才会在提供覆盖保护备份的情况下安全执行。
- **成本预防与限制:** 默认应用了工具使用次数和追加字符数限制，以防止 AI 故障或无限循环。（用户可随时在高级设置中调整这些限制。）
- **如何使用:** 在聊天中输入 `/mcp` 命令，或使用顶部图标打开快捷弹出窗口并启用"代理模式"。(内部 Lumina 服务器将在需要时自动启动以执行工具。)
</details>

<details>
<summary><b>🔌 MCP 集成 (双向客户端与服务端支持)</b></summary>

- **描述:** 通过模型上下文协议 (MCP) 无缝桥接 Obsidian 与更广泛的 AI 生态系统。将 Obsidian 作为一个全能的 AI 枢纽，或将其用作您 AI 的第二大脑！
- **💻 客户端模式 (Obsidian 主导):**
  - 在 Obsidian 内部直接与 AI 互动并进行工作。
  - 连接众多外部 MCP 服务器（GitHub、本地数据库、网络搜索等），将海量数据即时抓取并整理到您的笔记中。
- **🖥️ 服务端模式 (外部 AI 主导):**
  - 提供 多个工具，允许外部 AI 助手（Claude、Cursor 等）或代理模式的 AI 直接访问您的库。
  - **网页搜索:** `lumina_web_search` (使用Tavily、Exa、Google等各种搜索引擎进行实时互联网信息搜索，支持智能截断)
  - **读取与搜索:** `read_active_note`, `read_note`, `search_notes` (支持标签过滤), `list_notes`, `rag_search`, `get_backlinks`, `get_note_metadata`, `list_attachments`, `list_tags` 为 AI 提供广泛的上下文。
  - **编写与修改:** `create_note`, `append_to_note`, `replace_note`, `patch_note`, `update_frontmatter`, `save_attachment`, `create_canvas`, `generate_moc`, `auto_link_note` (创建/修改笔记和画布文件、生成 MOC 核心笔记以及保存二进制文件)。
  - **管理与执行:** `delete_note`, `move_note` (移动/重命名), `execute_code`, `run_note_code_block` (在沙盒内执行代码, `run_shell_command` (在桌面操作系统上执行终端 shell 命令)。
  - **每日笔记:** `read_daily_note`, `append_to_daily_note` (针对今天每日笔记的读写集成)。
  - **强大的安全与用户控制:** 内容修改、文件删除或代码执行等破坏性操作不能由代理单独处理。它们只有在通过 UI（差异查看器和任务警告模态框）提示用户并获得最终批准 (Accept) 后，才会在提供覆盖保护备份的情况下安全执行。
- **如何使用:** 在插件设置中启用 MCP 功能，并配置客户端/服务端传输方法 (SSE)。
- **注意:** *Lumina 配备了多层安全机制，包括沙盒代码执行、基于实时差异查看器的用户批准 (Human-in-the-Loop)、文件修改期间的自动备份（覆盖保护）以及防止无限循环的限制。然而，由于代理和外部 AI 会直接访问您的库，我们建议最初密切监控操作。*
</details>

---

## 🐛 调试模式与错误报告

通过在设置中的 [附加组件与其他] 选项卡下启用高级设置并切换 [调试模式]，您可以查看插件处理的所有内部数据。（调试日志在下载前不会保存。）

**💡 帮助解决问题的信息:**
- 您的操作系统 (Windows, macOS, Linux) 和 Obsidian 版本。
- 使用的 AI 提供商和模型名称 (例如：OpenAI / gpt-4o, Ollama / llama3)。
- 调试模式下发生错误后下载的日志文件。
> [!IMPORTANT]
> 由于日志文件可能包含聊天记录，请在提交前删除所有敏感信息。
> **[报告错误 (GitHub Issues)](https://github.com/lumina-apps/obsidian-lumina/issues)**

---

## ☕ 支持与赞助

此插件 100% 免费分发，并将持续更新。

👉 **[Ko-fi](https://ko-fi.com/luminaapps)**  
👉 **[Ctee](https://ctee.kr/place/luminaapps)**