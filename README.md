# 🚀 Lumina: All-in-One AI Assistant (RAG + MCP + Agent)

**`Lumina` is a powerful all-in-one assistant plugin for Obsidian that transforms your knowledge base into a complete AI hub by combining multi-LLM support, zero-config RAG, bidirectional MCP integration, and autonomous AI agents.**

<p align="center">
  <b>English</b> | <a href="/docs/README_KO.md">한국어</a> | <a href="/docs/README_JA.md">日本語</a> | <a href="/docs/README_ZH.md">简体中文</a> | <a href="/docs/README_ZH_TW.md">繁體中文</a> | <a href="/docs/README_ES.md">Español</a> | <a href="/docs/README_DE.md">Deutsch</a> | <a href="/docs/README_FR.md">Français</a> | <a href="/docs/README_PT.md">Português</a> | <a href="/docs/README_RU.md">Русский</a> | <a href="/docs/README_IT.md">Italiano</a>
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

1. **Install** and enable `Lumina` from the Obsidian Community Plugins.
2. Once enabled, the built-in RAG model will automatically begin analyzing your notes in the background. (Smart navigation becomes available in the side panel).
3. **[Enable AI Chat]** Navigate to Obsidian Settings ➔ `Lumina`.
4. Add your preferred LLM provider and enter your API keys.
   - 💻 **Local LLMs (Ollama, LM Studio, etc.)** can be connected instantly without API keys!
   - ☁️ **Cloud LLMs** require API keys, which can easily be obtained for free:
     - 👉 [Get Google Gemini API Key (Free)](https://aistudio.google.com/app/apikey)
     - 👉 [Get Groq API Key (Free)](https://console.groq.com/keys)
5. **[Open Chat & Basic Usage]** Click the 💬 icon on the left ribbon menu to open the Chat View and start interacting with the AI, or highlight text in the editor and right-click to trigger Quick Actions.
6. **[Enable Agent Mode]** Type the `/mcp` command in the chat or open the quick popup menu to activate **🤖 Agent Mode**.
   - *Tip: The internal Lumina server required for the agent's autonomous operations will automatically start in the background.*
7. **Issue Autonomous Tasks:** With Agent Mode active, give complex instructions like, "Find all notes related to 'Artificial Intelligence' in my vault, summarize the key points, and organize them into a new note." The AI will autonomously determine and execute the necessary tools to complete the task.

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
- **Safety Mechanisms:** To prevent infinite loops or excessive API costs, a maximum execution step limit per request (default: 15 steps) is enforced. Execution is automatically aborted if repeated tool calls are detected.
- **How to use:** Type the `/mcp` command in the chat or use the top icon to open the quick popup and enable 'Agent Mode'. (The internal Lumina server will automatically start as needed to execute tools.)
</details>

<details>
<summary><b>🤖 MCP Integration (Bidirectional Client & Server Support) ⚠️</b></summary>

- **Description:** Seamlessly bridges Obsidian with the broader AI ecosystem via the Model Context Protocol (MCP). Use Obsidian as an all-in-one AI hub, or leverage it as your AI's second brain!
- **💻 Client Mode (Obsidian-led):**
  - Interact and work directly with AI within Obsidian.
  - Connect numerous external MCP servers (GitHub, local DBs, web search, etc.) to instantly scrape and organize vast amounts of data into your notes.
- **🖥️ Server Mode (External AI-led):**
  - Exposes 7 tools allowing external AI assistants (Claude, Cursor, etc.) to directly access your vault.
  - `read_active_note`, `read_note`, `search_notes`, `rag_search`: Provides your vault's context and knowledge to the AI.
  - `create_note`, `append_to_note`: Allows the AI to safely write organized ideas directly into your vault (overwriting protection applied).
  - `read_daily_note`, `append_to_daily_note`: Read/write integration for today's daily note.
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

👉 **[GitHub Sponsor](https://github.com/sponsors/lumina-apps)**  
👉 **[Ko-fi](https://ko-fi.com/luminaapps)**  
👉 **[Ctee](https://ctee.kr/place/luminaapps)**