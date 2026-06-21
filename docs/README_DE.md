# 🚀 Lumina: All-in-One KI-Assistent (RAG + MCP + Agent)

**`Lumina` ist ein leistungsstarkes All-in-One-Assistent-Plugin für Obsidian, das deine Wissensbasis in einen vollständigen KI-Hub verwandelt, indem es Multi-LLM-Unterstützung, Zero-Config-RAG, bidirektionale MCP-Integration und autonome KI-Agenten kombiniert.**

<p align="center">
  <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/README.md">English</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_KO.md">한국어</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_JA.md">日本語</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ZH.md">简体中文</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ZH_TW.md">繁體中文</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ES.md">Español</a> | <b>Deutsch</b> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_FR.md">Français</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_PT.md">Português</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_RU.md">Русский</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_IT.md">Italiano</a>
</p>

> 🌐 **Für mehrsprachige Umgebungen optimiert!** Die integrierten Embedding-Modelle und die Benutzeroberfläche sind vollständig für mehrsprachige Umgebungen lokalisiert. (Feedback zur Übersetzung ist jederzeit willkommen!)

![alt text](readme.gif)

---

## 🌟 Hauptfunktionen

| Funktion | Beschreibung |
| :--- | :--- |
| **💬 Multi-LLM-Chat-Ansicht** | Ein dediziertes Seitenpanel, das den Kontext deiner Notizen versteht. Unterstützt alles von leistungsstarken Cloud-Modellen bis hin zu lokalen LLMs für maximale Privatsphäre. |
| **🧠 Zero-Config-RAG** | Bietet 100% Offline-Lokale-Embeddings, um Datenlecks zu verhindern. Indiziert deinen Vault automatisch in Echtzeit ohne komplexe Konfigurationen. |
| **🔗 Smart Discovery** | Findet semantisch relevante Dokumente zur aktuellen Notiz, warnt vor Duplikaten und fügt empfohlene Tags sowie Links mit einem Klick ein. |
| **⚡ Inline-KI-Schnellaktionen** | Markiere Text im Editor, um ihn sofort zusammenzufassen, zu übersetzen oder Korrektur zu lesen, ohne deinen Schreibfluss zu unterbrechen. |
| **🚀 Smart-Agent-Modus** | AI plant und führt komplexe Aufgaben wie Suchen, Erstellen, Ändern, Löschen/Verschieben von Notizen und Codeausführung im Sandbox-Modus mit 23 integrierten MCP-Tools autonom aus. |
| **🔌 MCP-Integration (Client & Server)** | Eine bidirektionale Full-Stack-Integration, mit der Sie externe Tools in Obsidian verwenden (Client) oder externe AIs mit Ihren Notizen interagieren lassen (Server) können. |

---

## ⚡ Schnellstart

Lumina bietet zwei auf dein Können zugeschnittene Modi. Wähle die Methode, die dir zusagt!

### 🟢 Track 1: In 3 Schritten starten (für Anfänger empfohlen)
1. Installiere und aktiviere Lumina.
2. Gehe zu Einstellungen > Lumina und gib deinen **kostenlosen API-Schlüssel (Gemini oder Groq)** ein, den du über die folgenden Links erhalten hast.
   - 👉 [Google Gemini API-Schlüssel holen (Kostenlos)](https://aistudio.google.com/app/apikey)
   - 👉 [Groq API-Schlüssel holen (Kostenlos)](https://console.groq.com/keys)
3. Öffne eine beliebige Notiz und stelle Lumina eine Frage im rechten Seitenpanel. Fertig! (Sobald die lokale RAG-Indizierung im Seitenpanel abgeschlossen ist, werden Unterhaltungen basierend auf deinen Notizen sofort aktiviert.)

### 🔵 Track 2: Den Agenten meistern (für Fortgeschrittene empfohlen)
1. Verbinde ein lokales LLM oder deine bevorzugte Cloud-KI in den Einstellungen.
2. Gib `/mcp` im Chat ein, um den **Smart Agent Mode** zu aktivieren.
3. Erteile autonome Befehle wie: "Finde alle Besprechungsnotizen dieser Woche in meinem Vault und erstelle eine einzige Zusammenfassungsdatei daraus."

> [!IMPORTANT]
> **🔒 Sichere Speicherung von API-Schlüsseln**
> Alle eingegebenen API-Schlüssel werden niemals als Klartextdateien gespeichert. Sie werden über Obsidians integrierten `SecretStorage` sicher verschlüsselt und lokal gespeichert, um sicherzustellen, dass deine Daten sicher bleiben.

---

## ✨ Detaillierte Funktionen & Nutzung (Zum Erweitern klicken)
<details>
<summary><b>💬 Multi-LLM-Chat-Ansicht (Cloud- & Lokaler Support)</b></summary>

- **Beschreibung:** Unterhalte dich sofort mit verschiedenen KI-Modellen über ein dediziertes Seitenpanel in Obsidian. Unterstützt vollständig leistungsstarke Cloud-Modelle wie Gemini und Groq sowie **lokale LLMs** (Ollama, LM Studio usw.) für absolute Privatsphäre.
- **Verwendung:** Klicke auf das 💬-Symbol im linken Ribbon oder führe `Lumina: Open Chat` über die Befehlspalette aus.
- **💡 Profi-Tipp:** Markiere Text im Editor, klicke mit der rechten Maustaste und nutze das Kontextmenü, um den markierten Text als Kontext direkt in den Chat für deine Fragen zu injizieren!
</details>

<details>
<summary><b>🧠 RAG-basierter Chat & Lokale Embeddings (Absolute Privatsphäre)</b></summary>

- **Beschreibung:** Die KI erhält tiefe Einblicke in deine Wissensbasis. Sie sucht während Unterhaltungen autonom nach relevanten Notizen und zeigt ähnliche Dokumente und empfohlene Tags im Seitenpanel an, wodurch smarte kontextuelle Verknüpfungen entstehen.
- **Offline-Sicherheit:** Das RAG-System von Lumina verwendet 100% Offline-Lokaleinbettungen (integriertes mehrsprachiges Einbettungsmodell `ibm-granite`), um Ihre Notizen zu analysieren. Solange kein Cloud-Modell ausgewählt ist, verlassen Ihre wertvollen Notizdaten niemals Ihr Gerät.
- **Vollständig automatisiert:** Keine Konfiguration erforderlich! Die Hintergrundindizierung startet leise im Moment der Aktivierung des Plugins und synchronisiert sich automatisch in Echtzeit (`watch`-Modus), wenn Notizen geändert werden.
</details>

<details>
<summary><b>🔗 Smart Discovery</b></summary>

- **Beschreibung:** Basierend auf der RAG-Engine visualisiert die Funktion Informationen, die für die aktuell geschriebene Notiz hochgradig relevant sind, direkt auf der Registerkarte „Smart Discovery“ in der Seitenleiste.
- **Hauptfunktionen:**
  - **Semantische Suche:** Geht über den einfachen Keyword-Abgleich hinaus und analysiert den Kontext und die Bedeutung des eingegebenen Satzes, um nach ähnlichen Notizen zu suchen.
  - **Duplikaterkennung:** Zeigt eine Warnung an, wenn ein Dokument mit sehr ähnlichem Inhalt bereits in Ihrem Vault vorhanden ist, um Informationsfragmentierung und doppeltes Schreiben zu verhindern.
  - **Empfohlene Tags & Ähnliche Notizen:** Analysiert den Kontext der aktuellen Notiz, um passende Tags zu empfehlen und ähnliche Notizen in Echtzeit vorzuschlagen.
  - **Ein-Klick-Verbindung & Chat:** Fügen Sie empfohlene Tags oder ähnliche Notizen mit einem einzigen Klick als Tags oder Markdown-Links (`[[Notizname]]`) in Ihr Dokument ein oder stellen Sie ausgewählte Notizen im Staging-Bereich bereit, um sofort einen KI-Chat zu starten.
  - **Verwendung:** Klicken Sie auf das 💬-Symbol in der linken Leiste, um die Seitenleiste zu öffnen, und wechseln Sie oben auf die Registerkarte 🔗 (Smart Discovery).
</details>

<details>
<summary><b>⚡ Inline-Editor-KI (Schnellaktionen)</b></summary>

- **Beschreibung:** Transformiere Text sofort im Markdown-Editor, ohne deinen Schreibfluss zu unterbrechen. Handhabe problemlos Übersetzungen, Zusammenfassungen, Grammatikkorrekturen und detaillierte Erklärungen für markierten Text.
- **Verwendung:** Markiere den Text und führe Schnellaktionen über das Inline-Popup-Menü oder die Befehlspalette aus. *(💡 Tipp: Weise in den Obsidian-Einstellungen Hotkeys für blitzschnellen Zugriff zu!)*
</details>

<details>
<summary><b>🚀 Smart-Agent-Modus</b></summary>

- **Beschreibung:** Nach der Aktivierung bestimmt und orchestriert das LLM autonom 23 integrierte MCP-Tools, um Aufgaben auszuführen. Es kann komplexe, mehrstufige Vorgänge ausführen, indem es das Suchen, Lesen und Schreiben von Notizen, das Abrufen von RAG-Daten, die Ausführung von Code in einer Sandbox und die Integration täglicher Notizen kombiniert.
- **Lokale LLM-Unterstützung:** Implementiert einen dedizierten Parser, der textbasiertes Tool-Prompting unterstützt, sodass der Agent auch in lokalen LLM-Umgebungen reibungslos funktioniert und nicht nur mit leistungsstarken Cloud-Modellen.
- **Robuste Sicherheit & Benutzerkontrolle (Human-in-the-Loop):** Destruktive Vorgänge wie Inhaltsänderungen, Dateilöschungen oder Codeausführungen können vom Agenten nicht allein verarbeitet werden. Sie werden erst nach einer Abfrage des Benutzers über eine Benutzeroberfläche (Diff-Viewer und Aufgabenwarnungs-Modal) und Erhalt der endgültigen Genehmigung (Akzeptieren) sicher mit Backups zum Schutz vor Überschreiben ausgeführt.
- **Kostenvermeidung & Limits:** Standardbegrenzungen für die Häufigkeit der Toolnutzung und die Länge der angehängten Zeichen werden angewendet, um KI-Fehlfunktionen oder Endlosschleifen zu verhindern. (Diese Limits können in den erweiterten Einstellungen frei angepasst werden.)
- **Verwendung:** Geben Sie den Befehl `/mcp` im Chat ein oder klicken Sie auf das obere Symbol, um das Schnell-Popup zu öffnen und den „Agenten-Modus“ zu aktivieren. (Der interne Lumina-Server startet bei Bedarf automatisch, um Tools auszuführen.)
</details>

<details>
<summary><b>🔌 MCP-Integration (Client & Server Support)</b></summary>

- **Beschreibung:** Überbrückt Obsidian nahtlos mit dem breiteren KI-Ökosystem über das Model Context Protocol (MCP). Nutze Obsidian als All-in-One-KI-Hub oder nutze es als das zweite Gehirn deiner KI!
- **💻 Client-Modus (Obsidian-gesteuert):**
  - Interagiere und arbeite direkt mit KI innerhalb von Obsidian.
  - Verbinde zahlreiche externe MCP-Server (GitHub, lokale Datenbanken, Web-Suche usw.), um sofort riesige Datenmengen zu scrapen und in deinen Notizen zu organisieren.
- **🖥️ Server-Modus (Externe KI-gesteuert):**
  - Stellt 23 Tools zur Verfügung, die externen KI-Assistenten (Claude, Cursor usw.) oder der Agentenmodus-KI direkten Zugriff auf deinen Vault gewähren.
  - **Lesen & Suchen:** `read_active_note`, `read_note`, `search_notes` (unterstützt Tag-Filter), `list_notes`, `rag_search`, `get_backlinks`, `get_note_metadata`, `list_attachments`, `list_tags` um der KI umfangreichen Kontext bereitzustellen.
  - **Schreiben & Ändern:** `create_note`, `append_to_note`, `replace_note`, `patch_note`, `update_frontmatter`, `save_attachment`, `create_canvas`, `generate_moc` (Notizen/Canvas-Dateien erstellen/ändern, Map of Content (MOC)-Notizen generieren und Binärdateien speichern).
  - **Verwalten & Ausführen:** `delete_note`, `move_note` (verschieben/umbenennen), `execute_code`, `run_note_code_block` (Code in einer Sandbox ausführen).
  - **Tagesnotizen:** `read_daily_note`, `append_to_daily_note` (Lese-/Schreibintegration für die heutige Tagesnotiz).
  - **Robuste Sicherheit & Benutzerkontrolle:** Destruktive Vorgänge wie Inhaltsänderungen, Dateilöschungen oder Codeausführung können vom Agenten nicht allein verarbeitet werden. Sie werden sicher mit Überschreibschutz-Backups ausgeführt, jedoch erst, nachdem dem Benutzer eine Benutzeroberfläche (Diff-Viewer und Warnungs-Modal) angezeigt und die endgültige Genehmigung (Accept) erteilt wurde.
- **Verwendung:** Aktiviere MCP-Funktionen in den Plugin-Einstellungen und konfiguriere die Client/Server-Transportmethode (SSE).
- **Hinweis:** *Lumina verfügt über mehrschichtige Sicherheitsmechanismen, darunter Sandbox-Codeausführung, Benutzergenehmigungen über einen Echtzeit-Diff-Viewer (Human-in-the-Loop), automatische Backups bei Dateiänderungen (Überschreibschutz) und Begrenzungen zur Vermeidung von Endlosschleifen. Da der Agent und externe AIs jedoch direkt auf Ihren Vault zugreifen, empfehlen wir, die Vorgänge anfangs genau zu überwachen.*
</details>

---

## 🐛 Debug-Modus & Fehlerberichte

Du kannst alle internen Daten einsehen, die das Plugin verarbeitet, indem du die Erweiterten Einstellungen aktivierst und den [Debug-Modus] unter dem Tab [Add-ons & Sonstiges] einschaltest. (Debug-Logs werden erst nach dem Herunterladen gespeichert).

**💡 Hilfreiche Informationen zur Fehlerbehebung:**
- Dein Betriebssystem (Windows, macOS, Linux) und die Obsidian-Version.
- Der KI-Anbieter und der Name des verwendeten Modells (z. B. OpenAI / gpt-4o, Ollama / llama3).
- Die Logdatei, die nach dem Auftreten des Fehlers im Debug-Modus heruntergeladen wurde.
> [!IMPORTANT]
> Da Logdateien Chat-Transkripte enthalten können, entferne bitte sensible Informationen vor dem Einreichen.
> **[Fehler melden (GitHub Issues)](https://github.com/lumina-apps/obsidian-lumina/issues)**

---

## ☕ Support & Sponsoring

Dieses Plugin wird zu 100% kostenlos vertrieben und wird kontinuierlich aktualisiert.
 
👉 **[Ko-fi](https://ko-fi.com/luminaapps)**  
👉 **[Ctee](https://ctee.kr/place/luminaapps)**