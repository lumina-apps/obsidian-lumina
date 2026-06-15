# 🚀 Lumina: All-in-One AI 助手 (RAG + MCP + Agent)

**`Lumina` 是一款強大的 Obsidian 全能助手外掛，它將多 LLM 支援、零設定 RAG、雙向 MCP 整合和自主 AI 代理結合在一起，把您的知識庫變成一個完整的 AI 樞紐。**

<p align="center">
  <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/README.md">English</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_KO.md">한국어</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_JA.md">日本語</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ZH.md">简体中文</a> | <b>繁體中文</b> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ES.md">Español</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_DE.md">Deutsch</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_FR.md">Français</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_PT.md">Português</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_RU.md">Русский</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_IT.md">Italiano</a>
</p>

> 🌐 **多語言環境最佳化完畢！** 內建的嵌入模型和 UI 已完全針對多語言環境進行了在地化。（隨時歡迎提供翻譯回饋！）

![alt text](readme.gif)

---

## 🌟 主要功能

| 功能 | 描述 |
| :--- | :--- |
| **💬 多 LLM 聊天視圖** | 專屬的側邊欄，能夠理解您筆記的上下文。支援從強大的雲端模型到注重隱私的本地 LLM 的各種模型。 |
| **🧠 零設定 RAG** | 提供 100% 離線的本地嵌入，防止資料外洩。無須複雜設定，即可即時自動對您的儲存庫進行索引。 |
| **⚡ 內聯 AI 快速操作** | 在編輯器中反白選取文字，即可立即進行總結、翻譯或校對，不會打斷您的寫作流程。 |
| **🤖 自主 AI 代理** | LLM 可自主規劃和執行複雜的任務，如使用 MCP 工具搜尋、建立和修改筆記。（實驗性功能） |
| **🔌 MCP 整合 (用戶端與伺服器端)** | 雙向、全端式整合，讓您可以在 Obsidian 內部使用外部工具（用戶端），或讓外部 AI 與您的筆記進行互動（伺服器端）。（實驗性功能） |

---

## ⚡ 快速開始

Lumina 根據您的熟練程度提供兩種模式。選擇適合您的方式！

### 🟢 軌道 1：3 步快速上手（推薦初學者）
1. 安裝並啟用 Lumina。
2. 前往設定 > Lumina，輸入從下方連結取得的**免費 API 金鑰（Gemini 或 Groq）**。
   - 👉 [獲取 Google Gemini API 金鑰 (免費)](https://aistudio.google.com/app/apikey)
   - 👉 [獲取 Groq API 金鑰 (免費)](https://console.groq.com/keys)
3. 開啟任意筆記並在右側邊欄面板中向 Lumina 提問。就這樣！（側面板中本地 RAG 索引完成後，基於您筆記的對話將立即啟動。）

### 🔵 軌道 2：掌握代理模式（推薦進階使用者）
1. 在設定中連接本地 LLM 或您正在使用的雲端 AI。
2. 在聊天中輸入 `/mcp` 以啟動**智能代理模式**。
3. 可以發布自主任務命令，例如：「在我的儲存庫中找出本週的所有會議記錄，並將它們整理成一個摘要檔案。」

> [!IMPORTANT]
> **🔒 安全的 API 金鑰儲存**
> 您輸入的所有 API 金鑰絕不會以純文字檔案形式儲存。它們透過 Obsidian 內建的 `SecretStorage` 進行安全加密並儲存在本地，確保您的資料安全無虞。

---

## ✨ 詳細功能與用法 (點擊展開)

<details>
<summary><b>💬 多 LLM 聊天視圖 (支援雲端與本地)</b></summary>

- **描述:** 透過 Obsidian 內部的專屬側邊欄，與各種 AI 模型進行即時對話。完全支援 Gemini 和 Groq 等強大的雲端模型，以及確保絕對隱私的**本地 LLM**（Ollama、LM Studio 等）。
- **如何使用:** 點擊左側欄上的 💬 圖示，或從命令選擇區執行 `Lumina: Open Chat`。
- **💡 提示:** 在編輯器中反白選取文字，按右鍵並使用上下文功能表，將所選文字作為上下文直接注入聊天中提問！
</details>

<details>
<summary><b>🧠 基於 RAG 的聊天與本地嵌入 (絕對隱私)</b></summary>

- **描述:** AI 深入洞察您的知識庫。它在對話期間自主搜尋相關筆記，並在側邊欄顯示相似文件和推薦標籤，建立智能的上下文連結。
- **離線安全:** 原生支援本地嵌入 (`ibm-granite`)。除非選擇了雲端模型，否則您寶貴的筆記資料絕不會離開您的裝置。
- **全自動化:** 無須任何設定！背景索引會在外掛啟用時悄悄開始，並在修改筆記時即時 (`watch` 模式) 自動同步。
</details>

<details>
<summary><b>⚡ 內聯編輯器 AI (快速操作)</b></summary>

- **描述:** 在 Markdown 編輯器中即時轉換文字，而不會打斷您的寫作流程。輕鬆處理選定文字的翻譯、總結、語法糾正和詳細解釋。
- **如何使用:** 反白選取文字，透過內聯彈出功能表或命令選擇區執行快速操作。*(💡 提示: 在 Obsidian 設定中分配快捷鍵以實現極速訪問！)*
</details>

<details>
<summary><b>🤖 自主 AI 代理 (代理模式) ⚠️</b></summary>

- **描述:** 啟動後，LLM 可自主確定並協調 MCP 工具來執行任務。它可以透過結合筆記搜尋、讀取、寫入和 RAG 檢索來完成複雜的多步操作。
- **本地 LLM 支援:** 實現了一個專門的解析器，支援基於文字的工具提示，使代理即使在本地 LLM 環境下也能順利運行，而不僅僅依賴高效能的雲端模型。
- **安全工具構成:** 初始版本僅包含以讀取和安全建立為中心的工具，從根本上消除了現有檔案被覆蓋或刪除的風險。
- **使用者批准機制 (Human-in-the-Loop):** 在執行檔案修改等有風險的操作之前，必須經過使用者的確認（批准）彈窗。
- **成本預防與限制:** 預設應用了工具使用次數和附加字元數限制，以防止 AI 故障或無限循環。（使用者可隨時在進階設定中調整這些限制。）
- **如何使用:** 在聊天中輸入 `/mcp` 命令，或使用頂部圖示打開快捷彈出視窗並啟用「代理模式」。(內部 Lumina 伺服器將在需要時自動啟動以執行工具。)
</details>

<details>
<summary><b>🤖 MCP 整合 (雙向用戶端與伺服器端支援) ⚠️</b></summary>

- **描述:** 透過模型上下文協議 (MCP) 無縫橋接 Obsidian 與更廣泛的 AI 生態系統。將 Obsidian 作為一個全能的 AI 樞紐，或將其用作您 AI 的第二大腦！
- **💻 用戶端模式 (Obsidian 主導):**
  - 在 Obsidian 內部直接與 AI 互動並進行工作。
  - 連接眾多外部 MCP 伺服器（GitHub、本地資料庫、網路搜尋等），將海量資料即時抓取並整理到您的筆記中。
- **🖥️ 伺服器端模式 (外部 AI 主導):**
  - 提供 7 個工具，允許外部 AI 助手（Claude、Cursor 等）直接存取您的儲存庫。
  - `read_active_note`, `read_note`, `search_notes`, `list_notes`, `rag_search`: 為 AI 提供您儲存庫的上下文和知識。
  - `create_note`, `append_to_note`: 允許 AI 整理思路並直接將內容安全地寫入您的儲存庫（應用了覆蓋保護）。
  - `read_daily_note`, `append_to_daily_note`: 針對今天的每日筆記的讀/寫整合。
  - 檔案刪除、移動或覆蓋等危險操作將在未來的更新中配備額外的安全措施。
- **如何使用:** 在外掛設定中啟用 MCP 功能，並配置用戶端/伺服器端傳輸方法 (SSE)。
- **注意:** *代理和 MCP 功能目前處於實驗性（測試版）階段。雖然實施了覆蓋保護和字元限制等多種安全網，但由於外部 AI 將直接編輯您的筆記，我們建議最初密切監控操作。*
</details>

---

## 🐛 除錯模式與錯誤報告

透過在設定中的 [附加元件與其他] 索引標籤下啟用進階設定並切換 [除錯模式]，您可以查看外掛處理的所有內部資料。（除錯記錄在下載前不會儲存。）

**💡 幫助解決問題的資訊:**
- 您的作業系統 (Windows, macOS, Linux) 和 Obsidian 版本。
- 使用的 AI 提供商和模型名稱 (例如：OpenAI / gpt-4o, Ollama / llama3)。
- 除錯模式下發生錯誤後下載的記錄檔。
> [!IMPORTANT]
> 由於記錄檔可能包含聊天記錄，請在提交前刪除所有敏感資訊。
> **[報告錯誤 (GitHub Issues)](https://github.com/lumina-apps/obsidian-lumina/issues)**

---

## ☕ 支援與贊助

此外掛 100% 免費分發，並將持續更新。
贊助能讓我更有動力，更快地推出更新！

👉 **[Ko-fi](https://ko-fi.com/luminaapps)**  
👉 **[Ctee](https://ctee.kr/place/luminaapps)**
