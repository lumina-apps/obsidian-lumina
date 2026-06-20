# 🚀 Lumina: オールインワン AI アシスタント (RAG + MCP + Agent)

**`Lumina` は、マルチLLMサポート、ゼロコンフィグRAG、双方向MCP連携、自律型AIエージェントを組み合わせ、あなたのナレッジベースを完全なAIハブへと変えるObsidian用の強力なオールインワンアシスタントプラグインです。**

<p align="center">
  <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/README.md">English</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_KO.md">한국어</a> | <b>日本語</b> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ZH.md">简体中文</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ZH_TW.md">繁體中文</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ES.md">Español</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_DE.md">Deutsch</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_FR.md">Français</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_PT.md">Português</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_RU.md">Русский</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_IT.md">Italiano</a>
</p>

> 🌐 **多言語環境に最適化完了！** 組み込みのエンベディングモデルとUIは多言語環境向けに完全にローカライズされています。（翻訳のフィードバックはいつでも歓迎します！）

![alt text](readme.gif)

---

## 🌟 主な機能

| 機能 | 説明 |
| :--- | :--- |
| **💬 マルチLLMチャットビュー** | ノートの文脈を理解する専用サイドパネル。強力なクラウドモデルから、プライバシー重視のローカルLLMまで幅広く対応します。 |
| **🧠 ゼロコンフィグ RAG** | データ漏洩を防ぐ完全オフラインのローカルエンベディングを搭載。複雑な設定なしにリアルタイムでボルトを自動インデックス化します。 |
| **⚡ インライン AI クイックアクション** | エディタ内のテキストをハイライトするだけで、執筆のフローを妨げることなく即座に要約、翻訳、校正を実行できます。 |
| **🤖 自律型 AI エージェント** | LLMがMCPツールを使用してノートの検索、作成、修正など、複雑なタスクを自律的に計画・実行します。（試験的機能） |
| **🔌 MCP 連携 (Client & Server)** | Obsidian内で外部ツールを使用したり（Client）、逆に外部のAIにノートを操作させたり（Server）できる双方向のフルスタック連携機能です。（試験的機能） |

---

## ⚡ クイックスタート

Luminaは、あなたのスキルレベルに合わせた2つのトラックを提供しています。自分に合った方法をお選びください！

### 🟢 トラック1: 3ステップでスタート（初心者向け）
1. Luminaをインストールして有効化します。
2. 設定 > Luminaに移動し、以下のリンクから取得した**無料APIキー（GeminiまたはGroq）** を入力します。
   - 👉 [Google Gemini APIキーの取得（無料）](https://aistudio.google.com/app/apikey)
   - 👉 [Groq APIキーの取得（無料）](https://console.groq.com/keys)
3. 任意のノートを開き、右側のサイドバーパネルでLuminaに質問してください。これで完了です！（サイドパネルでローカルRAGのインデックス作成が完了すると、ノートに基づいた会話が即座に有効になります。）

### 🔵 トラック2: エージェントを極める（上級者向け）
1. 設定画面でローカルLLMまたはお使いのクラウドAIを接続します。
2. チャットに `/mcp` と入力して**スマートエージェントモード**を起動します。
3. 「今週の議事録をすべて見つけて、1つの要約ファイルにまとめて」のような自律型タスクを指示できます。

> [!IMPORTANT]
> **🔒 安全なAPIキーの保存**
> 入力したすべてのAPIキーは、プレーンテキストファイルとして保存されることは絶対にありません。Obsidianの組み込み `SecretStorage` を介して安全に暗号化され、ローカルに保存されるため、データは安全に保たれます。

---

## ✨ 詳細な機能と使い方（クリックして展開）

<details>
<summary><b>💬 マルチLLMチャットビュー（クラウド＆ローカル対応）</b></summary>

- **説明:** Obsidian内の専用サイドパネルを通じて様々なAIモデルと即座に会話できます。GeminiやGroqなどの強力なクラウドモデルだけでなく、絶対的なプライバシーのための**ローカルLLM**（Ollama、LM Studioなど）も完全にサポートします。
- **使い方:** 左側リボンの💬アイコンをクリックするか、コマンドパレットから `Lumina: チャットを開く` を実行します。
- **💡 プロのヒント:** エディタでテキストをハイライトし、右クリックしてコンテキストメニューを使用すると、選択したテキストをコンテキストとして直接チャットに挿入して質問できます！
</details>

<details>
<summary><b>🧠 RAG搭載チャット＆ローカルエンベディング（絶対的なプライバシー）</b></summary>

- **説明:** AIがあなたのナレッジベースを深く理解します。会話中に関連するノートを自律的に検索し、類似したドキュメントや推奨されるタグをサイドパネルに表示し、スマートなコンテキストリンクを作成します。
- **オフラインセキュリティ:** ローカルエンベディング（`ibm-granite`）をネイティブにサポートします。クラウドモデルを選択しない限り、あなたの大切なノートのデータがデバイスから外部に出ることは決してありません。
- **完全自動化:** 設定は一切不要です！プラグインが有効になった瞬間にバックグラウンドのインデックス作成が静かに始まり、ノートが変更されるたびにリアルタイム（`watch`モード）で自動的に同期します。
</details>

<details>
<summary><b>⚡ インラインエディタAI（クイックアクション）</b></summary>

- **説明:** 執筆の流れを断ち切ることなく、Markdownエディタ内でテキストを即座に変換します。選択したテキストの翻訳、要約、文法修正、詳細な説明などを簡単に処理します。
- **使い方:** テキストをハイライトし、インラインポップアップメニューまたはコマンドパレットからクイックアクションを実行します。*（💡 ヒント: Obsidianの設定でホットキーを割り当てると、非常にすばやくアクセスできます！）*
</details>

<details>
<summary><b>🤖 自律型AIエージェント（エージェントモード） ⚠️</b></summary>

- **説明:** 有効にすると、LLMが自律的に判断し、MCPツールを組み合わせてタスクを実行します。ノートの検索、読み取り、書き込み、RAG検索を組み合わせて、複雑で多段階の操作を完了できます。
- **ローカルLLMサポート:** テキストベースのツールプロンプトをサポートする専用パーサーを実装し、高性能なクラウドモデルだけでなく、ローカルLLM環境でもエージェントがスムーズに機能するようにします。
- **安全なツール構成:** 初期バージョンでは読み取り中心および安全な作成志向のツールのみが含まれており、既存ファイルが上書きまたは削除されるリスクを根本的に排除しています。
- **ユーザー承認に基づく動作（Human-in-the-Loop）:** ファイル修正などのリスクがある操作を実行する前に、必ずユーザーの確認（承認）ポップアップを表示します。
- **過剰使用防止と制限:** AIの誤動作や無限ループを防ぐため、ツール使用回数および追加(Append)文字数制限がデフォルトで適用されています。（これらの制限は詳細設定でいつでもユーザーが調整できます。）
- **使い方:** チャットで `/mcp` コマンドを入力するか、上部のアイコンを使用してクイックポップアップを開き、「エージェントモード」を有効にします。（ツールを実行するために、内部のLuminaサーバーが自動的に起動します。）
</details>

<details>
<summary><b>🤖 MCP連携（双方向のクライアント＆サーバーサポート） ⚠️</b></summary>

- **説明:** Model Context Protocol (MCP) を介して、Obsidianと広範なAIエコシステムをシームレスに結びつけます。ObsidianをオールインワンのAIハブとして使用するか、AIのセカンドブレインとして活用しましょう！
- **💻 クライアントモード（Obsidian主導）:**
  - Obsidian内でAIと直接対話して作業します。
  - 多数の外部MCPサーバー（GitHub、ローカルDB、Web検索など）に接続し、膨大なデータをノートに即座にスクレイピングして整理します。
- **🖥️ サーバーモード（外部AI主導）:**
  - 外部のAIアシスタント（Claude、Cursorなど）またはエージェントモードのAIがあなたのボルトに直接アクセスできる21のツールを提供します。
  - **閲覧と検索:** `read_active_note`, `read_note`, `search_notes`（タグフィルター対応）, `list_notes`, `rag_search`, `get_backlinks`, `get_note_metadata`, `list_attachments`, `list_tags` により、AIに広範なコンテキストを提供します。
  - **作成と修正:** `create_note`, `append_to_note`, `replace_note`, `patch_note`, `update_frontmatter`, `save_attachment` （ノートの作成・修正とバイナリファイルの保存）。
  - **管理と実行:** `delete_note`, `move_note`（移動・名前変更）, `execute_code`, `run_note_code_block` （サンドボックス内でのコード実行）。
  - **デイリーノート:** `read_daily_note`, `append_to_daily_note` （今日のノートへの読み書き統合）。
  - **堅牢なセキュリティとユーザーコントロール:** コンテンツの変更、ファイルの削除、コードの実行などの破壊的な操作は、エージェント単独では処理できません。ユーザーにUI（差分ビューアや警告モーダル）を提示し、最終承認（Accept）を受けた場合にのみ、上書き保護のバックアップとともに安全に実行されます。
- **使い方:** プラグイン設定でMCP機能を有効にし、クライアント/サーバーの転送方法（SSE）を設定します。
- **注意:** *エージェント機能とMCP機能は現在、試験的（ベータ）段階です。上書き保護や文字数制限などのさまざまなセーフティネットが配置されていますが、外部AIがノートを直接編集するため、最初は操作を注意深く監視することをお勧めします。*
</details>

---

## 🐛 デバッグモードとバグレポート

設定の [アドオンとその他] タブにある [デバッグモード] をオンにすることで、プラグインが内部で処理するすべてのデータを確認できます。（デバッグログはダウンロードされるまで保存されません。）

**💡 解決に役立つ情報:**
- ご利用のOS（Windows、macOS、Linux）およびObsidianのバージョン。
- 使用したAIプロバイダーとモデル名（例: OpenAI / gpt-4o、Ollama / llama3）。
- デバッグモードでエラーが発生した後にダウンロードされたログファイル。
> [!IMPORTANT]
> ログファイルにはチャットのやり取りが含まれる場合があるため、送信前に機密情報を削除してください。
> **[バグを報告する (GitHub Issues)](https://github.com/lumina-apps/obsidian-lumina/issues)**

---

## ☕ サポートとスポンサー

このプラグインは100%無料で配布されており、継続的に更新されます。
スポンサーからの支援は、アップデートをより早く進めるためのモチベーションになります！
 
👉 **[Ko-fi](https://ko-fi.com/luminaapps)**  
👉 **[Ctee](https://ctee.kr/place/luminaapps)**
