# 🚀 Lumina: All-in-One AI Assistant (RAG + MCP + Agent)

**`Lumina` is a powerful all-in-one assistant plugin for Obsidian that transforms your knowledge base into a complete AI hub by combining multi-LLM support, zero-config RAG, bidirectional MCP integration, and autonomous AI agents.**

<p align="center">
  <b>English</b> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_KO.md">한국어</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_JA.md">日本語</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ZH.md">简体中文</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ZH_TW.md">繁體中文</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ES.md">Español</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_DE.md">Deutsch</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_FR.md">Français</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_PT.md">Português</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_RU.md">Русский</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_IT.md">Italiano</a>
</p>

> 🌐 **Multilingual Environment Optimized!** The built-in embedding models and UI are fully localized for multilingual environments. (Translation feedback is always welcome!)

![alt text](docs/readme.gif)

---

## 🌟 Main Features

| Feature | Description |
| :--- | :--- |
| **💬 Multi-LLM Chat View** | A dedicated side panel that understands the context of your notes. Supports everything from powerful cloud models to local LLMs for maximum privacy. |
| **🧠 Zero-Config RAG** | Features 100% offline local embeddings to prevent data leaks. Automatically indexes your vault in real-time without complex configurations. |
| **⚡ Inline AI Quick Actions** | Highlight text in the editor to instantly summarize, translate, or proofread without interrupting your writing flow. |
| **🤖 Autonomous AI Agent** | LLMs autonomously plan and execute complex tasks such as searching, creating, and modifying notes using MCP tools. (Experimental) |
| **🔌 MCP Integration (Client & Server)** | A bidirectional, full-stack integration that allows you to use external tools within Obsidian (Client), or let external AIs interact with your notes (Server). (Experimental) |

---

## ⚡ Quick Start

Lumina offers two tracks tailored to your skill level. Choose the one that suits you best!

### 🟢 Track 1: Start in 3 Steps (Recommended for Beginners)
1. Install and enable Lumina.
2. Go to Settings > Lumina and enter your **free API key (Gemini or Groq)** obtained from the links below.
   - 👉 [Get Google Gemini API Key (Free)](https://aistudio.google.com/app/apikey)
   - 👉 [Get Groq API Key (Free)](https://console.groq.com/keys)
3. Open any note and ask Lumina a question in the right sidebar panel. That's it! (Once the local RAG indexing is complete in the side panel, conversations based on your notes will be immediately activated.)

### 🔵 Track 2: Master the Agent (Recommended for Advanced Users)
1. Connect a local LLM or your cloud AI of choice in the settings.
2. Type `/mcp` in the chat to activate **Smart Agent Mode**.
3. Issue autonomous commands like, "Find all this week's meeting notes in my vault and compile them into a single summary file."

> [!IMPORTANT]
> **🔒 Secure API Key Storage**
> All API keys you enter are never stored as plain text files. They are securely encrypted and stored locally via Obsidian's built-in `SecretStorage`, ensuring your data remains safe.

---

## ✨ Detailed Features & Usage (Click to Expand)

<details>
<summary><b>💬 Multi-LLM Chat View (Cloud & Local Support)</b></summary>

- **Description:** Instantly converse with various AI models via a dedicated side panel inside Obsidian. Fully supports powerful cloud models like Gemini and Groq, as well as **Local LLMs** (Ollama, LM Studio, etc.) for absolute privacy.
- **How to use:** Click the 💬 icon on the left ribbon or execute `Lumina: Open Chat` from the command palette.
- **💡 Pro Tip:** Highlight text in the editor, right-click, and use the context menu to directly inject the selected text into the chat as context for your questions!
</details>

<details>
<summary><b>🧠 RAG-Powered Chat & Local Embeddings (Absolute Privacy)</b></summary>

- **Description:** AI gains deep insight into your knowledge base. It autonomously searches relevant notes during conversations and displays similar documents and recommended tags in the side panel, creating smart contextual links.
- **Offline Security:** Natively supports local embeddings (`ibm-granite`). Unless a cloud model is selected, your valuable note data will never leave your device.
- **Fully Automated:** Zero configuration required! Background indexing quietly starts the moment the plugin is enabled, and automatically syncs in real-time (`watch` mode) whenever notes are modified.
</details>

<details>
<summary><b>⚡ Inline Editor AI (Quick Actions)</b></summary>

- **Description:** Instantly transform text within the markdown editor without breaking your writing flow. Easily handle translation, summarization, grammar correction, and detailed explanations for selected text.
- **How to use:** Highlight the text and execute Quick Actions via the inline popup menu or command palette. *(💡 Tip: Assign hotkeys in Obsidian settings for lightning-fast access!)*
</details>

<details>
<summary><b>🤖 Autonomous AI Agent (Agent Mode) ⚠️</b></summary>

- **Description:** When activated, the LLM autonomously determines and orchestrates MCP tools to perform tasks. It can complete complex, multi-step operations by combining note searching, reading, writing, and RAG retrieval.
- **Local LLM Support:** Implements a dedicated parser that supports text-based tool prompting, allowing the agent to function smoothly even in Local LLM environments, not just with high-performance cloud models.
- **Safe Tool Composition:** The initial version includes only read-focused and safe creation-oriented tools, fundamentally eliminating the risk of existing files being overwritten or deleted.
- **Human-in-the-Loop (User Approval):** Before performing risky operations such as file modifications, a user confirmation (approval) popup is always displayed.
- **Cost Prevention & Limits:** Default limits on tool usage count and append character length are applied to prevent AI malfunctions or infinite loops. (These limits can be freely adjusted by the user in advanced settings.)
- **How to use:** Type the `/mcp` command in the chat or use the top icon to open the quick popup and enable 'Agent Mode'. (The internal Lumina server will automatically start as needed to execute tools.)
</details>

<details>
<summary><b>🤖 MCP Integration (Bidirectional Client & Server Support) ⚠️</b></summary>

- **Description:** Seamlessly bridges Obsidian with the broader AI ecosystem via the Model Context Protocol (MCP). Use Obsidian as an all-in-one AI hub, or leverage it as your AI's second brain!
- **💻 Client Mode (Obsidian-led):**
  - Interact and work directly with AI within Obsidian.
  - Connect numerous external MCP servers (GitHub, local DBs, web search, etc.) to instantly scrape and organize vast amounts of data into your notes.
- **🖥️ Server Mode (External AI-led):**
  - Provides 21 tools allowing external AI assistants (Claude, Cursor, etc.) or the Agent Mode AI to directly access your vault.
  - **Read & Search:** `read_active_note`, `read_note`, `search_notes` (supports tag filtering), `list_notes`, `rag_search`, `get_backlinks`, `get_note_metadata`, `list_attachments`, `list_tags` to provide extensive context to the AI.
  - **Write & Modify:** `create_note`, `append_to_note`, `replace_note`, `patch_note`, `update_frontmatter`, `save_attachment` (create/modify notes and save binary files).
  - **Manage & Execute:** `delete_note`, `move_note` (move/rename), `execute_code`, `run_note_code_block` (execute code within a sandbox).
  - **Daily Notes:** `read_daily_note`, `append_to_daily_note` (read/write integration for today's daily note).
  - **Robust Security & User Control:** Destructive operations such as content modification, file deletion, or code execution cannot be processed by the agent alone. They are executed safely with overwrite-protection backups only after prompting the user with a UI (Diff Viewer and Task Warning Modal) and receiving final approval (Accept).
- **How to use:** Enable MCP features in the plugin settings and configure the client/server transport method (SSE).
- **Note:** *Agent and MCP features are currently in Experimental (Beta) phase. While various safety nets like overwrite protection and character limits are in place, we recommend initially monitoring operations closely as external AI will directly edit your notes.*
</details>

---

## 🐛 Debug Mode & Bug Reports

You can view all internal data processed by the plugin by enabling Advanced Settings and toggling [Debug Mode] under the [Add-ons & Misc] tab in settings. (Debug logs are not saved until downloaded.)

**💡 Helpful Information for Resolution:**
- Your OS (Windows, macOS, Linux) and Obsidian version.
- The AI Provider and Model Name used (e.g., OpenAI / gpt-4o, Ollama / llama3).
- The log file downloaded after the error occurred in Debug Mode.
> [!IMPORTANT]
> Since log files may contain chat transcripts, please remove any sensitive information before submitting.
> **[Report a Bug (GitHub Issues)](https://github.com/lumina-apps/obsidian-lumina/issues)**

---

## ☕ Support & Sponsor

This plugin is distributed 100% free of charge and will be continuously updated.
Sponsorships keep me motivated to push out updates even faster!

👉 **[Ko-fi](https://ko-fi.com/luminaapps)**  
👉 **[Ctee](https://ctee.kr/place/luminaapps)**