# Lumina: All-in-One KI-Assistent (RAG + MCP + CLI-Agenten)

**`Lumina` ist ein leistungsstarkes All-in-One-Assistent-Plugin für Obsidian, das deine Wissensbasis in einen vollständigen KI-Hub verwandelt, indem es Multi-LLM-Unterstützung (Cloud & Lokal), Terminal-CLI-Agenten (Claude Code, Antigravity, OpenCode, Codex), Zero-Config-RAG, bidirektionale MCP-Integration und autonome KI-Agenten kombiniert.**

<p align="center">
  <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/README.md">English</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_KO.md">한국어</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_JA.md">日本語</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ZH.md">简体中文</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ZH_TW.md">繁體中文</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ES.md">Español</a> | <b>Deutsch</b> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_FR.md">Français</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_PT.md">Português</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_RU.md">Русский</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_IT.md">Italiano</a>
</p>

> **Für mehrsprachige Umgebungen optimiert!** Die integrierten Embedding-Modelle und die Benutzeroberfläche sind vollständig für mehrsprachige Umgebungen lokalisiert. (Feedback zur Übersetzung ist jederzeit willkommen!)

![alt text](readme.gif)

---

## Hauptfunktionen

| Funktion | Beschreibung |
| :--- | :--- |
| **Multi-LLM-Chat-Ansicht** | Ein dediziertes Seitenpanel, das den Kontext deiner Notizen versteht. Unterstützt alles von leistungsstarken Cloud-Modellen bis hin zu lokalen LLMs für maximale Privatsphäre. |
| **Terminal-CLI-Agenten-Integration** | Führe offizielle Terminal-KI-Agenten (Claude Code, Antigravity, OpenCode, Codex) direkt im Obsidian-Seitenpanel mit Echtzeit-Denkströmen und Lese-/Bearbeitungs-Sicherheitsmodi aus. |
| **Zero-Config-RAG** | Bietet 100% Offline-Lokale-Embeddings, um Datenlecks zu verhindern. Indiziert deinen Vault automatisch in Echtzeit ohne komplexe Konfigurationen. |
| **Smart Discovery** | Findet semantisch relevante Dokumente zur aktuellen Notiz, warnt vor Duplikaten und fügt empfohlene Tags sowie Links mit einem Klick ein. |
| **Inline-KI-Schnellaktionen** | Markiere Text im Editor, um ihn sofort zusammenzufassen, zu übersetzen oder Korrektur zu lesen, ohne deinen Schreibfluss zu unterbrechen. |
| **Smart-Agent-Modus** | AI plant und führt komplexe Aufgaben wie Suchen, Erstellen, Ändern, Löschen/Verschieben von Notizen und Codeausführung im Sandbox-Modus mit verschiedenen integrierten MCP-Tools autonom aus. |
| **MCP-Integration (Client & Server)** | Eine bidirektionale Full-Stack-Integration, mit der Sie externe Tools in Obsidian verwenden (Client) oder externe AIs mit Ihren Notizen interagieren lassen (Server) können. |

---

## Schnellstart

Lumina bietet zwei auf dein Können zugeschnittene Modi. Wähle die Methode, die dir zusagt!

### Track 1: In 3 Schritten starten (für Anfänger empfohlen)
1. Installiere und aktiviere Lumina.
2. Gehe zu Einstellungen > Lumina und gib deinen **kostenlosen API-Schlüssel (Gemini oder Groq)** ein, den du über die folgenden Links erhalten hast.
   - [Google Gemini API-Schlüssel holen (Kostenlos)](https://aistudio.google.com/app/apikey)
   - [Groq API-Schlüssel holen (Kostenlos)](https://console.groq.com/keys)
3. Öffne eine beliebige Notiz und stelle Lumina eine Frage im rechten Seitenpanel. Fertig! (Sobald die lokale RAG-Indizierung im Seitenpanel abgeschlossen ist, werden Unterhaltungen basierend auf deinen Notizen sofort aktiviert.)

### Track 2: Den Agenten meistern (für Fortgeschrittene empfohlen)
1. Verbinde ein lokales LLM oder deine bevorzugte Cloud-KI in den Einstellungen.
2. Gib `/mcp` im Chat ein, um den **Smart Agent Mode** zu aktivieren.
3. Erteile autonome Befehle wie: "Finde alle Besprechungsnotizen dieser Woche in meinem Vault und erstelle eine einzige Zusammenfassungsdatei daraus."

> [!IMPORTANT]
> **Sichere Speicherung von API-Schlüsseln**
> Alle eingegebenen API-Schlüssel werden niemals als Klartextdateien gespeichert. Sie werden über Obsidians integrierten `SecretStorage` sicher verschlüsselt und lokal gespeichert, um sicherzustellen, dass deine Daten sicher bleiben.

---

## Detaillierte Funktionen & Nutzung (Zum Erweitern klicken)
<details>
<summary><b>Multi-LLM-Chat-Ansicht (Cloud- & Lokaler Support)</b></summary>

- **Beschreibung:** Unterhalte dich sofort mit verschiedenen KI-Modellen über ein dediziertes Seitenpanel in Obsidian. Unterstützt vollständig leistungsstarke Cloud-Modelle wie Gemini und Groq sowie **lokale LLMs** (Ollama, LM Studio usw.) für absolute Privatsphäre.
- **Verwendung:** Klicke auf das Chat-Symbol im linken Ribbon oder führe `Lumina: Open Chat` über die Befehlspalette aus.
- **Profi-Tipp:** Markiere Text im Editor, klicke mit der rechten Maustaste und nutze das Kontextmenü, um den markierten Text als Kontext direkt in den Chat für deine Fragen zu injizieren!
</details>

<details>
<summary><b>Terminal-CLI-Agenten-Integration (Claude Code, Antigravity, OpenCode, Codex)</b></summary>

- **Beschreibung:** Führe Terminal-KI-Agenten direkt im Seitenpanel von Obsidian aus, um deine Vault-Notizen zu erkunden, zu analysieren und zu organisieren.
- **Unterstützte Agenten:** Anthropic **Claude Code**, Google **Antigravity**, **OpenCode**, OpenAI **Codex**.
- **Hauptfunktionen:**
  - **Sicherheitsumschaltung Nur-Lesen / Bearbeiten:** Wechsle mit einem Klick in der Chat-Symbolleiste zwischen 👁️ **Nur-Lesen-Modus** (Notizen sicher durchsuchen und analysieren, ohne Dateien zu ändern) und ✏️ **Bearbeitungsmodus**.
  - **Visuelles Denken (Thinking):** Streamt und visualisiert den internen Denkprozess des CLI-Agenten in einklappbaren Echtzeit-Denkblöcken.
  - **Echtzeit-Status & Geänderte Dateien:** Zeigt den Ausführungsstatus von Tools in Echtzeit an und bietet klickbare Badges, um vom Agenten geänderte Dateien sofort zu öffnen.
  - **Aktive Notiz & Medienkontext:** Übergibt automatisch die aktuell geöffnete Notiz und angehängte Bilder/Dateien an den CLI-Prompt für nahtlose kontextbezogene Unterhaltungen.
  - **Externe Terminal-MCP-Synchronisierung (Optional):** Erstellt Konfigurationsdateien (`.claude/mcp.json`, `opencode.json`, `codex.json`) in deinem Vault, damit CLI-Sitzungen im Systemterminal ebenfalls auf Luminas MCP-Tools zugreifen können.
- **Verwendung:** Wähle in den Lumina-Einstellungen > Verbindungen (Connections) deinen bevorzugten CLI-Provider, konfiguriere den Binärpfad und starte das Gespräch im Seitenpanel.
</details>

<details>
<summary><b>RAG-basierter Chat & Lokale Embeddings (Absolute Privatsphäre)</b></summary>

- **Beschreibung:** Die KI erhält tiefe Einblicke in deine Wissensbasis. Sie sucht während Unterhaltungen autonom nach relevanten Notizen und zeigt ähnliche Dokumente und empfohlene Tags im Seitenpanel an, wodurch smarte kontextuelle Verknüpfungen entstehen.
- **Offline-Sicherheit:** Das RAG-System von Lumina verwendet 100% Offline-Lokaleinbettungen (integriertes mehrsprachiges Einbettungsmodell `ibm-granite`), um Ihre Notizen zu analysieren. Solange kein Cloud-Modell ausgewählt ist, verlassen Ihre wertvollen Notizdaten niemals Ihr Gerät.
- **Vollständig automatisiert:** Keine Konfiguration erforderlich! Die Hintergrundindizierung startet leise im Moment der Aktivierung des Plugins und synchronisiert sich automatisch in Echtzeit (`watch`-Modus), wenn Notizen geändert werden.
</details>

<details>
<summary><b>Smart Discovery</b></summary>

- **Beschreibung:** Bietet basierend auf der RAG-Engine visuell gebündelte Informationen zur aktuellen Notiz im Tab "Smart Discovery" des Seitenpanels.
- **Hauptfunktionen:**
  - **Semantische Suche:** Geht über einfache Schlüsselwortabgleiche hinaus und sucht ähnliche Notizen basierend auf Bedeutung und Kontext.
  - **Duplikaterkennung:** Warnt vor bereits existierenden, sehr ähnlichen Dokumenten im Vault.
  - **Empfohlene Tags & verwandte Notizen:** Schlägt in Echtzeit passende Tags und Verknüpfungen vor.
  - **Ein-Klick-Integration:** Fügt empfohlene Tags oder Links (`[[Notizname]]`) mit einem Klick ein oder startet direkt eine KI-Konversation.
- **Verwendung:** Klicke auf das Chat-Symbol im linken Ribbon und wechsle oben zum Tab Smart Discovery.
</details>

<details>
<summary><b>Inline-KI-Schnellaktionen</b></summary>

- **Beschreibung:** Transformiere Text direkt im Markdown-Editor (Übersetzen, Zusammenfassen, Korrekturlesen).
- **Verwendung:** Markiere Text und führe Schnellaktionen über das Inline-Menü oder die Befehlspalette aus.
</details>

<details>
<summary><b>Smart-Agent-Modus</b></summary>

- **Beschreibung:** Ermöglicht der KI, Aufgaben autonom mit integrierten MCP-Tools (Suchen, Lesen, Schreiben, RAG, Sandbox-Code, Tagesnotizen) auszuführen.
- **Lokaler LLM-Support:** Textbasierter Tool-Parser für reibungslose Funktion auch mit lokalen LLMs.
- **Robuste Sicherheit & Benutzerkontrolle (Human-in-the-Loop):** Destruktive Vorgänge wie Dateiänderungen, Löschungen oder Codeausführung können vom Agenten nicht eigenständig verarbeitet werden. Dateiänderungen erfordern eine **Inline-Diff-Prüfung** im Editor mit abschnittsweiser Annahme/Ablehnung, während sensible Aktionen wie Dateierstellung, Löschung oder Codeausführung eine ausdrückliche Bestätigung über **Inline-Genehmigungskarten** im Chat-Panel erfordern. (Automatischer Überschreibschutz durch Backups inklusive)
- **Kosten- und Schleifenschutz:** Integrierte Limits für Tool-Nutzung und Zeichenlänge.
- **Verwendung:** Gib `/mcp` im Chat ein oder aktiviere den Agentenmodus über das Symbol oben.
</details>

<details>
<summary><b>MCP-Integration (Client & Server Support)</b></summary>

- **Beschreibung:** Überbrückt Obsidian nahtlos mit dem breiteren KI-Ökosystem über das Model Context Protocol (MCP). Nutze Obsidian als All-in-One-KI-Hub oder nutze es als das zweite Gehirn deiner KI!
- **Client-Modus (Obsidian-gesteuert):**
  - Interagiere und arbeite direkt mit KI innerhalb von Obsidian.
  - Verbinde zahlreiche externe MCP-Server (GitHub, lokale Datenbanken, Web-Suche usw.), um sofort riesige Datenmengen zu scrapen und in deinen Notizen zu organisieren.
- **Server-Modus (Externe KI-gesteuert):**
  - Stellt verschiedene Tools zur Verfügung, die externen KI-Assistenten (Claude, Cursor usw.) oder der Agentenmodus-KI direkten Zugriff auf deinen Vault gewähren.
  - **Websuche:** `lumina_web_search` (Echtzeit-Internetinformationssuche über verschiedene Suchmaschinen wie Tavily, Exa, Google mit intelligenter Kürzungsunterstützung)
  - **Lesen & Suchen:** `read_active_note`, `read_note` (unterstützt Zeilenbereich `startLine`/`endLine`), `search_notes` (unterstützt Tag-Filter), `grep_search` (Regex/Text-Zeilensuche im gesamten Vault), `glob_files` (Wildcard-Dateipfadabgleich, z. B. `**/*.md`), `list_notes`, `rag_search`, `get_backlinks`, `get_note_metadata`, `list_attachments`, `list_tags`, `query_metadata` um der KI umfangreichen Kontext bereitzustellen.
  - **Schreiben & Ändern:** `create_note`, `append_to_note`, `replace_note`, `patch_note`, `update_frontmatter`, `save_attachment`, `create_canvas`, `generate_moc`, `auto_link_note` (Notizen/Canvas-Dateien erstellen/ändern, Map of Content (MOC)-Notizen generieren und Binärdateien speichern).
  - **Verwalten & Ausführen:** `open_note` (Notiz/Datei sofort im Editor-Tab öffnen), `delete_note`, `move_note` (verschieben/umbenennen), `execute_code`, `run_note_code_block` (Code in einer Sandbox ausführen), `run_shell_command` (Terminal-Shell-Befehle auf dem Desktop-OS ausführen), `show_notice` (Obsidian-Benachrichtigungen anzeigen).
  - **Tagesnotizen:** `read_daily_note`, `append_to_daily_note` (Lese-/Schreibintegration für die heutige Tagesnotiz).
  - **MCP-Synchronisierung für externe Terminal-CLIs:** Synchronisiert optional Konfigurationsdateien (`.claude/mcp.json`, `opencode.json`, `codex.json`), damit externe Terminal-CLIs Luminas Vault-Tools nutzen können.
  - **Vault-Sicherheit & Benutzerkontrolle (Human-in-the-Loop):** Inline-Genehmigungskarten für sensible Aktionen, Inline-Diff-Prüfung im Editor bei Dateiänderungen, automatische Backups zum Schutz vor Überschreiben und isolierte Codeausführung in einer Sandbox.
- **Verwendung:** Aktiviere MCP-Funktionen in den Plugin-Einstellungen und konfiguriere die Client/Server-Transportmethode (SSE).
- **Hinweis:** *Lumina verfügt über mehrschichtige Sicherheitsmechanismen wie Sandbox-Codeausführung, Inline-Diff-Prüfung und Benutzergenehmigungen (Human-in-the-Loop), automatische Backups bei Dateiänderungen (Überschreibschutz) und Limits zur Vermeidung von Endlosschleifen und unkontrollierten Tool-Aufrufen. Da der Agent und externe KIs jedoch direkt auf deinen Vault zugreifen, empfehlen wir, die Vorgänge anfangs aufmerksam zu beobachten.*
</details>

---

## Debug-Modus & Fehlerberichte

Du kannst alle internen Daten einsehen, die das Plugin verarbeitet, indem du die Erweiterten Einstellungen aktivierst und den [Debug-Modus] unter dem Tab [Sonstiges & Extras] einschaltest. (Debug-Logs werden erst nach dem Herunterladen gespeichert).

**Hilfreiche Informationen zur Fehlerbehebung:**
- Dein Betriebssystem (Windows, macOS, Linux) und die Obsidian-Version.
- Der KI-Anbieter und der Name des verwendeten Modells (z. B. OpenAI / gpt-4o, Ollama / llama3).
- Die Logdatei, die nach dem Auftreten des Fehlers im Debug-Modus heruntergeladen wurde.
> [!IMPORTANT]
> Da Logdateien Chat-Transkripte enthalten können, entferne bitte sensible Informationen vor dem Einreichen.
> **[Fehler melden (GitHub Issues)](https://github.com/lumina-apps/obsidian-lumina/issues)**

---

## Support & Sponsoring

Dieses Plugin wird zu 100% kostenlos vertrieben und wird kontinuierlich aktualisiert.
 
**[Ko-fi](https://ko-fi.com/luminaapps)**  
**[Ctee](https://ctee.kr/place/luminaapps)**