# 🚀 Lumina: All-in-One AI 助手 (RAG + MCP + Agent)

**`Lumina` 是一款强大的 Obsidian 全能助手插件，它将多 LLM 支持、零配置 RAG、双向 MCP 集成和自主 AI 代理结合在一起，把您的知识库变成一个完整的 AI 枢纽。**

<p align="center">
  <a href="/README.md">English</a> | <a href="/docs/README_KO.md">한국어</a> | <a href="/docs/README_JA.md">日本語</a> | <b>简体中文</b> | <a href="/docs/README_ZH_TW.md">繁體中文</a> | <a href="/docs/README_ES.md">Español</a> | <a href="/docs/README_DE.md">Deutsch</a> | <a href="/docs/README_FR.md">Français</a> | <a href="/docs/README_PT.md">Português</a> | <a href="/docs/README_RU.md">Русский</a> | <a href="/docs/README_IT.md">Italiano</a>
</p>

> 🌐 **多语言环境优化完毕！** 内置的嵌入模型和 UI 已完全针对多语言环境进行了本地化。（随时欢迎提供翻译反馈！）

![alt text](readme.gif)

---

## 🌟 主要功能

| 功能 | 描述 |
| :--- | :--- |
| **💬 多 LLM 聊天视图** | 专属的侧边栏，能够理解您笔记的上下文。支持从强大的云端模型到注重隐私的本地 LLM 的各种模型。 |
| **🧠 零配置 RAG** | 提供 100% 离线的本地嵌入，防止数据泄露。无需复杂配置，即可实时自动对您的库进行索引。 |
| **⚡ 内联 AI 快速操作** | 在编辑器中高亮选中文本，即可立即进行总结、翻译或校对，不会打断您的写作流程。 |
| **🤖 自主 AI 代理** | LLM 可自主规划和执行复杂的任务，如使用 MCP 工具搜索、创建和修改笔记。（实验性功能） |
| **🔌 MCP 集成 (客户端与服务端)** | 双向、全栈式集成，让您可以在 Obsidian 内部使用外部工具（客户端），或让外部 AI 与您的笔记进行交互（服务端）。（实验性功能） |

---

## ⚡ 快速开始

1. 从 Obsidian 社区插件中**安装**并启用 `Lumina`。
2. 启用后，内置的 RAG 模型将自动在后台开始分析您的笔记。（侧边栏的智能导航功能将变得可用）。
3. **[启用 AI 聊天]** 导航到 Obsidian 设置 ➔ `Lumina`。
4. 添加您首选的 LLM 提供商并输入您的 API 密钥。
   - 💻 **本地 LLM (Ollama, LM Studio 等)** 无需 API 密钥即可立即连接！
   - ☁️ **云端 LLM** 需要 API 密钥，您可以轻松免费获取：
     - 👉 [获取 Google Gemini API 密钥 (免费)](https://aistudio.google.com/app/apikey)
     - 👉 [获取 Groq API 密钥 (免费)](https://console.groq.com/keys)
5. **[打开聊天和基本使用]** 点击左侧菜单栏的 💬 图标打开聊天视图，开始与 AI 互动；或者在编辑器中高亮文本，然后右键单击以触发快速操作。
6. **[启用代理模式]** 在聊天中输入 `/mcp` 命令，或打开快捷弹出菜单以激活 **🤖 代理模式**。
   - *提示：代理执行自主操作所需的 Lumina 内部服务器将在后台自动启动。*
7. **发布自主任务:** 代理模式处于活动状态时，给出复杂的指令，例如：“在我的库中查找所有与‘人工智能’相关的笔记，总结关键点，并将它们整理到一篇新笔记中。”AI 将自主确定并执行所需的工具来完成任务。

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
- **离线安全:** 原生支持本地嵌入 (`ibm-granite`)。除非选择了云端模型，否则您宝贵的笔记数据绝不会离开您的设备。*(⚠️ 移动端环境不支持本地嵌入。)*
- **全自动化:** 无需任何配置！后台索引会在插件启用时悄悄开始，并在修改笔记时实时 (`watch` 模式) 自动同步。
</details>

<details>
<summary><b>⚡ 内联编辑器 AI (快速操作)</b></summary>

- **描述:** 在 Markdown 编辑器中即时转换文本，而不会打断您的写作流程。轻松处理选定文本的翻译、总结、语法纠正和详细解释。
- **如何使用:** 高亮选中文本，通过内联弹出菜单或命令面板执行快速操作。*(💡 提示: 在 Obsidian 设置中分配快捷键以实现极速访问！)*
</details>

<details>
<summary><b>🤖 自主 AI 代理 (代理模式) ⚠️</b></summary>

- **描述:** 激活后，LLM 可自主确定并协调 MCP 工具来执行任务。它可以通过结合笔记搜索、读取、写入和 RAG 检索来完成复杂的多步操作。
- **本地 LLM 支持:** 实现了一个专门的解析器，支持基于文本的工具提示，使代理即使在本地 LLM 环境下也能顺利运行，而不仅仅依赖高性能的云端模型。
- **安全机制:** 为了防止无限循环或过高的 API 成本，系统强制执行每个请求的最大执行步数限制（默认：15 步）。如果检测到重复调用工具，将自动中止执行。
- **如何使用:** 在聊天中输入 `/mcp` 命令，或使用顶部图标打开快捷弹出窗口并启用“代理模式”。(内部 Lumina 服务器将在需要时自动启动以执行工具。)
</details>

<details>
<summary><b>🤖 MCP 集成 (双向客户端与服务端支持) ⚠️</b></summary>

- **描述:** 通过模型上下文协议 (MCP) 无缝桥接 Obsidian 与更广泛的 AI 生态系统。将 Obsidian 作为一个全能的 AI 枢纽，或将其用作您 AI 的第二大脑！
- **💻 客户端模式 (Obsidian 主导):**
  - 在 Obsidian 内部直接与 AI 互动并进行工作。
  - 连接众多外部 MCP 服务器（GitHub、本地数据库、网络搜索等），将海量数据即时抓取并整理到您的笔记中。
- **🖥️ 服务端模式 (外部 AI 主导):**
  - 提供 7 个工具，允许外部 AI 助手（Claude、Cursor 等）直接访问您的库。
  - `read_active_note`, `read_note`, `search_notes`, `rag_search`: 为 AI 提供您库的上下文和知识。
  - `create_note`, `append_to_note`: 允许 AI 整理思路并直接将内容安全地写入您的库（应用了覆盖保护）。
  - `read_daily_note`, `append_to_daily_note`: 针对今天的每日笔记的读/写集成。
- **如何使用:** 在插件设置中启用 MCP 功能，并配置客户端/服务端传输方法 (stdio/SSE)。
- **注意:** *代理和 MCP 功能目前处于实验性（测试版）阶段。移动端不支持 Stdio 连接。虽然实施了覆盖保护和字符限制等多种安全网，但由于外部 AI 将直接编辑您的笔记，我们建议最初密切监控操作。*
</details>

---

## 🐛 调试模式与错误报告

通过在设置中的 [附加组件与其他] 选项卡下启用高级设置并切换 [调试模式]，您可以查看插件处理的所有内部数据。（调试日志在下载前不会保存。）

**💡 帮助解决问题的信息:**
- 您的设备/操作系统 (PC / 移动设备) 和 Obsidian 版本。
- 使用的 AI 提供商和模型名称 (例如：OpenAI / gpt-4o, Ollama / llama3)。
- 调试模式下发生错误后下载的日志文件。
> [!IMPORTANT]
> 由于日志文件可能包含聊天记录，请在提交前删除所有敏感信息。
> **[报告错误 (GitHub Issues)](https://github.com/lumina-apps/obsidian-lumina/issues)**

---

## ☕ 支持与赞助

此插件 100% 免费分发，并将持续更新。
赞助能让我更有动力，更快地推出更新！

👉 **[GitHub Sponsor](https://github.com/sponsors/lumina-apps)**  
👉 **[Ko-fi](https://ko-fi.com/luminaapps)**  
👉 **[Ctee](https://ctee.kr/place/luminaapps)**
