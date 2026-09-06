# Lumina: All-in-One AI 助手 (RAG + MCP + CLI 智能體)

**`Lumina` 是一款強大的 Obsidian 全能助手外掛，它將多 LLM 支援（雲端與本地）、終端機 CLI 智能體聯動（Claude Code、Antigravity、OpenCode、Codex）、零設定 RAG、雙向 MCP 整合和自主 AI 代理結合在一起，把您的知識庫變成一個完整的 AI 工作空間。**

<p align="center">
  <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/README.md">English</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_KO.md">한국어</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_JA.md">日本語</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ZH.md">简体中文</a> | <b>繁體中文</b> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ES.md">Español</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_DE.md">Deutsch</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_FR.md">Français</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_PT.md">Português</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_RU.md">Русский</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_IT.md">Italiano</a>
</p>

> **多語言環境最佳化完畢！** 內建的嵌入模型和 UI 已完全針對多語言環境進行了在地化。（隨時歡迎提供翻譯回饋！）

![alt text](readme.gif)

---

## 主要功能

| 功能 | 描述 |
| :--- | :--- |
| **多 LLM 聊天視圖** | 專屬的側邊欄，能夠理解您筆記的上下文。支援從強大的雲端模型到注重隱私的本地 LLM 的各種模型。 |
| **終端機 CLI 智能體整合** | 在 Obsidian 側邊欄面板中直接運行官方終端機 AI 智能體（Claude Code、Antigravity、OpenCode、Codex），即時檢視思考過程，輕鬆探索與整理筆記。 |
| **零設定 RAG** | 提供 100% 離線的本地嵌入，防止資料外洩。無須複雜設定，即可即時自動對您的儲存庫進行索引。 |
| **智能探索 (Smart Discovery)** | 利用語義搜尋立即找到與當前正在撰寫的筆記高度相關的文檔，檢測並警告潛在的重複內容，並支援一鍵向正文插入推薦標籤和關聯連結。 |
| **內聯 AI 快速操作** | 在編輯器中反白選取文字，即可立即進行總結、翻譯或校對，不會打斷您的寫作流程。 |
| **智能代理模式** | AI 自主規劃並執行複雜的任務，如使用多種內置 MCP 工具進行筆記搜尋、建立、修改、刪除/移動以及在沙盒內執行程式碼。 |
| **MCP 整合 (用戶端與服務端)** | 雙向、全疊式整合，讓您可以在 Obsidian 內部使用外部工具（用戶端），或讓外部 AI 與您的筆記進行互動（服務端）。 |

---

## 快速開始

Lumina 根據您的熟練程度提供兩種模式。選擇適合您的方式！

### 軌道 1：3 步快速上手（推薦初學者）
1. 安裝並啟用 Lumina。
2. 前往設定 > Lumina，輸入從下方獲取的**免費 API 金鑰（Gemini 或 Groq）**。
   - [獲取 Google Gemini API 金鑰 (免費)](https://aistudio.google.com/app/apikey)
   - [獲取 Groq API 金鑰 (免費)](https://console.groq.com/keys)
3. 打開任意筆記並在右側邊欄面板中向 Lumina 提問。就這樣！（側面板中本地 RAG 索引完成後，基於您筆記的對話將立即啟動。）

### 軌道 2：掌握代理模式（推薦高級使用者）
1. 在設定中連線本地 LLM 或您正在使用的雲端 AI。
2. 在聊天中輸入 `/mcp` 以啟動**智能代理模式**。
3. 可以發布自主任務命令，例如："在我的儲存庫中找出本週的所有會議記錄，並將它們整理成一個摘要檔案。"

> [!IMPORTANT]
> **安全的 API 金鑰儲存**
> 您輸入的所有 API 金鑰絕不會以純文字檔案形式保存。它們透過 Obsidian 內建的 `SecretStorage` 進行安全加密並儲存在本地，確保您的資料安全無虞。

---

## 詳細功能與用法 (點擊展開)
<details>
<summary><b>多 LLM 聊天視圖 (支援雲端與本地)</b></summary>

- **描述:** 透過 Obsidian 內部的專屬側邊欄，與各種 AI 模型進行即時對話。完全支援 Gemini 和 Groq 等強大的雲端模型，以及確保絕對隱私的**本地 LLM**（Ollama、LM Studio 等）。
- **如何使用:** 點擊左側欄上的聊天圖示，或從命令面板執行 `Lumina: Open Chat`。
- **提示:** 在編輯器中反白選取文字，右鍵點擊並使用快顯功能表，將所選文字作為上下文直接注入聊天中提問！
</details>

<details>
<summary><b>終端機 CLI 智能體整合（Claude Code、Antigravity、OpenCode、Codex）</b></summary>

- **功能說明:** 直接在 Obsidian 側邊欄面板中運行終端機 AI 智能體，以探索、分析和整理您的儲存庫筆記。
- **支援的智能體:** Anthropic **Claude Code**、Google **Antigravity**、**OpenCode**、OpenAI **Codex**。
- **主要功能:**
  - **唯讀 / 編輯模式切換:** 在聊天工具列中一鍵切換 👁️ **唯讀模式**（阻止修改筆記，安全瀏覽與分析）與 ✏️ **編輯模式**。
  - **即時思考過程 (Thinking):** 將 CLI 智能體的內部推理過程以可摺疊的即時思考區塊形式呈現。
  - **即時運行狀態與修改檔案指示:** 即時顯示當前正在執行的工具狀態，並提供連結徽章以便直接開啟智能體修改的檔案。
  - **使用中筆記與附件自動傳遞:** 自動將當前開啟的使用中筆記和附加的圖片/檔案傳遞給智能體提示詞，實現無縫上下文對話。
  - **外部終端機 MCP 設定同步 (選用):** 在您的儲存庫中自動產生設定檔（`.claude/mcp.json`、`opencode.json`、`codex.json`），以便在系統終端機中直接運行 CLI 時也能調用 Lumina 的 MCP 工具。
- **如何使用:** 在 Lumina 設定 > 連線 (Connections) 標籤頁中選擇您偏好的 CLI 提供者，設定可執行檔路徑，即可在側邊面板直接開始對話。
</details>

<details>
<summary><b>基於 RAG 的聊天與本地嵌入 (絕對隱私)</b></summary>

- **描述:** AI 深入洞悉您的知識庫。它在對話期間自主搜尋相關筆記，並在側邊欄顯示相似文檔和推薦標籤，建立智能的上下文連結。
- **離線安全:** Lumina 的 RAG 系統使用 100% 離線的本地嵌入（內建 `ibm-granite` 多語言嵌入模型）來分析您的筆記。除非選擇了雲端模型，否則您寶貴的筆記資料絕不會離開您的裝置。
- **全自動化:** 無需任何設定！背景索引會在外掛啟用時悄悄開始，並在修改筆記時即時 (`watch` 模式) 自動同步。
</details>

<details>
<summary><b>智能探索 (Smart Discovery)</b></summary>

- **描述:** 基於 RAG 引擎，在側邊欄面板的"智能探索"索引標籤中，一目了然地視覺化提供與當前正在撰寫的筆記高度相關的資訊。
- **主要功能:**
  - **語義搜尋:** 超越簡單的關鍵字匹配，分析輸入句子的上下文和含義以進行筆記語義搜尋。
  - **重複文檔檢測:** 若儲存庫中已存在內容高度相似的文檔，將顯示警告以防止資訊碎片化和重複編寫。
  - **推薦標籤與關聯筆記:** 分析正在撰寫的筆記的上下文，即時推薦合適的標籤並建議關聯的筆記。
  - **一鍵聯通與對話:** 支援一鍵將推薦的標籤或關聯筆記作為標籤或 Markdown 連結（`[[筆記名稱]]`）插入到您的正文中，或將選定的筆記放入暫存區以立即啟動 AI 對話。
- **如何使用:** 點擊左側欄上的聊天圖示開啟側邊欄面板，並切換到頂部的智能探索索引標籤。
</details>

<details>
<summary><b>內聯編輯器 AI (快速操作)</b></summary>

- **描述:** 在 Markdown 編輯器中即時轉換文字，而不會打斷您的寫作流程。輕鬆處理選定文字的翻譯、總結、語法糾正和詳細解釋。
- **如何使用:** 反白選取文字，透過內聯彈出功能表或命令面板執行快速操作。*(提示: 在 Obsidian 設定中指派快速鍵以實現極速存取！)*
</details>

<details>
<summary><b>智能代理模式</b></summary>

- **描述:** 啟用後，LLM 會自主判斷並協調多種內建 MCP 工具來執行任務。它可以透過結合筆記搜尋、讀取、寫入、RAG 檢索、沙盒程式碼執行以及每日筆記整合來完成複雜的多步操作。
- **本地 LLM 支援:** 實現了一個專門的解析器，支援基於文字的工具提示，使代理即使在本地 LLM 環境下也能順利運行，而不僅僅依賴高性能的雲端模型。
- **強大的安全性與使用者控制 (Human-in-the-Loop):** 檔案修改、刪除或程式碼執行等破壞性操作無法由代理單獨執行。修改檔案時需在編輯器內透過**內嵌 Diff 審查**選擇逐塊接受/拒絕，而建立、刪除檔案或執行程式碼等敏感操作則需透過聊天面板中的**內嵌審批卡片**由使用者最終核准 (Accept) 後方可安全執行。（預設支援防覆蓋自動備份）
- **成本預防與限制:** 預設套用了工具使用次數和追加字元數限制，以防止 AI 故障或無限循環。（使用者可隨時在進階設定中調整這些限制。）
- **如何使用:** 在聊天中輸入 `/mcp` 命令，或使用頂部圖示開啟快捷快顯視窗並啟用"代理模式"。(內部 Lumina 伺服器將在需要時自動啟動以執行工具。)
</details>

<details>
<summary><b>MCP 整合 (雙向用戶端與服務端支援)</b></summary>

- **描述:** 透過模型上下文協定 (MCP) 無縫橋接 Obsidian 與更廣泛的 AI 生態系統。將 Obsidian 作為一個全能的 AI 樞紐，或將其用作您 AI 的第二大腦！
- **用戶端模式 (Obsidian 主導):**
  - 在 Obsidian 內部直接與 AI 互動並進行工作。
  - 連接眾多外部 MCP 伺服器（GitHub、本地資料庫、網路搜尋等），將海量資料即時抓取並整理到您的筆記中。
- **服務端模式 (外部 AI 主導):**
  - 提供多個工具，允許外部 AI 助手（Claude、Cursor 等）或代理模式的 AI 直接存取您的儲存庫。
  - **網頁搜尋:** `lumina_web_search` (使用Tavily、Exa、Google等各種搜尋引擎進行即時網際網路資訊搜尋，支援智慧截斷)
  - **讀取與搜尋:** `read_active_note`, `read_note` (支援行範圍 `startLine`/`endLine` 讀取), `search_notes` (支援標籤過濾), `grep_search` (全庫檔案正規表示式/文字行搜尋), `glob_files` (萬用字元檔案路徑匹配，如 `**/*.md`), `list_notes`, `rag_search`, `get_backlinks`, `get_note_metadata`, `list_attachments`, `list_tags`, `query_metadata` 為 AI 提供廣泛的上下文。
  - **編寫與修改:** `create_note`, `append_to_note`, `replace_note`, `patch_note`, `update_frontmatter`, `save_attachment`, `create_canvas`, `generate_moc`, `auto_link_note` (建立/修改筆記和畫布檔案、生成 MOC 核心筆記以及儲存二進位檔案)。
  - **管理與執行:** `open_note` (在編輯器分頁中即時開啟檔案/筆記), `delete_note`, `move_note` (移動/重新命名), `execute_code`, `run_note_code_block` (在沙盒內執行程式碼), `run_shell_command` (在桌面作業系統上執行終端機 shell 命令), `show_notice` (顯示 Obsidian 通知)。
  - **每日筆記:** `read_daily_note`, `append_to_daily_note` (針對今天每日筆記的讀寫整合)。
  - **外部終端機 CLI MCP 設定同步:** 在儲存庫中選擇性同步設定檔（`.claude/mcp.json`、`opencode.json`、`codex.json`），使外部終端機 CLI 也能調用 Lumina 的儲存庫工具，提供一致的工作體驗。
  - **儲存庫安全與使用者控制 (Human-in-the-Loop):** 針對敏感操作提供內嵌審批卡片，檔案修改時提供編輯器內嵌 Diff 審查，並提供防覆蓋自動備份和沙盒隔離程式碼執行。
- **如何使用:** 在外掛設定中啟用 MCP 功能，並設定用戶端/服務端傳輸方法 (SSE)。
- **注意:** *Lumina 配備了沙盒程式碼執行、即時內嵌 Diff 審查與使用者審批 (Human-in-the-Loop)、檔案修改自動備份（防覆蓋保護）以及防止無限循環和失控工具調用的限制等多層安全機制。不過，由於智能體和外部 AI 會直接存取您的儲存庫，建議初期先密切關注相關操作。*
</details>

---

## 除錯模式與錯誤報告

透過在設定中的 [附加功能與其他] 索引標籤下啟用進階設定並切換 [除錯模式]，您可以查看外掛處理的所有內部資料。（除錯記錄在下載前不會儲存。）

**幫助解決問題的資訊:**
- 您的作業系統 (Windows, macOS, Linux) 和 Obsidian 版本。
- 使用的 AI 提供商和模型名稱 (例如：OpenAI / gpt-4o, Ollama / llama3)。
- 除錯模式下發生錯誤後下載的記錄檔。
> [!IMPORTANT]
> 由於記錄檔可能包含聊天記錄，請在提交前刪除所有敏感資訊。
> **[報告錯誤 (GitHub Issues)](https://github.com/lumina-apps/obsidian-lumina/issues)**

---

## 支援與贊助

此外掛 100% 免費分發，並將持續更新。

**[Ko-fi](https://ko-fi.com/luminaapps)**  
**[Ctee](https://ctee.kr/place/luminaapps)**