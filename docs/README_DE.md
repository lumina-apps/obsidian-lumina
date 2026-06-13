# 🚀 Lumina: All-in-One KI-Assistent (RAG + MCP + Agent)

**`Lumina` ist ein leistungsstarkes All-in-One-Assistent-Plugin für Obsidian, das deine Wissensbasis in einen vollständigen KI-Hub verwandelt, indem es Multi-LLM-Unterstützung, Zero-Config-RAG, bidirektionale MCP-Integration und autonome KI-Agenten kombiniert.**

<p align="center">
  <a href="/README.md">English</a> | <a href="/docs/README_KO.md">한국어</a> | <a href="/docs/README_JA.md">日本語</a> | <a href="/docs/README_ZH.md">简体中文</a> | <a href="/docs/README_ZH_TW.md">繁體中文</a> | <a href="/docs/README_ES.md">Español</a> | <b>Deutsch</b> | <a href="/docs/README_FR.md">Français</a> | <a href="/docs/README_PT.md">Português</a> | <a href="/docs/README_RU.md">Русский</a> | <a href="/docs/README_IT.md">Italiano</a>
</p>

> 🌐 **Für mehrsprachige Umgebungen optimiert!** Die integrierten Embedding-Modelle und die Benutzeroberfläche sind vollständig für mehrsprachige Umgebungen lokalisiert. (Feedback zur Übersetzung ist jederzeit willkommen!)

![alt text](readme.gif)

---

## 🌟 Hauptfunktionen

| Funktion | Beschreibung |
| :--- | :--- |
| **💬 Multi-LLM-Chat-Ansicht** | Ein dediziertes Seitenpanel, das den Kontext deiner Notizen versteht. Unterstützt alles von leistungsstarken Cloud-Modellen bis hin zu lokalen LLMs für maximale Privatsphäre. |
| **🧠 Zero-Config-RAG** | Bietet 100% Offline-Lokale-Embeddings, um Datenlecks zu verhindern. Indiziert deinen Vault automatisch in Echtzeit ohne komplexe Konfigurationen. |
| **⚡ Inline-KI-Schnellaktionen** | Markiere Text im Editor, um ihn sofort zusammenzufassen, zu übersetzen oder Korrektur zu lesen, ohne deinen Schreibfluss zu unterbrechen. |
| **🤖 Autonomer KI-Agent** | LLMs planen und führen komplexe Aufgaben wie das Suchen, Erstellen und Ändern von Notizen mithilfe von MCP-Tools autonom aus. (Experimentell) |
| **🔌 MCP-Integration (Client & Server)** | Eine bidirektionale Full-Stack-Integration, mit der du externe Tools in Obsidian verwenden kannst (Client) oder externe KIs mit deinen Notizen interagieren lassen kannst (Server). (Experimentell) |

---

## ⚡ Schnellstart

1. **Installiere** und aktiviere `Lumina` aus den Obsidian Community-Plugins.
2. Sobald das Plugin aktiviert ist, beginnt das integrierte RAG-Modell automatisch im Hintergrund mit der Analyse deiner Notizen. (Smarte Navigation wird im Seitenpanel verfügbar).
3. **[KI-Chat aktivieren]** Navigiere zu Obsidian Einstellungen ➔ `Lumina`.
4. Füge deinen bevorzugten LLM-Anbieter hinzu und gib deine API-Schlüssel ein.
   - 💻 **Lokale LLMs (Ollama, LM Studio usw.)** können ohne API-Schlüssel sofort verbunden werden!
   - ☁️ **Cloud-LLMs** erfordern API-Schlüssel, die leicht kostenlos bezogen werden können:
     - 👉 [Google Gemini API-Schlüssel holen (Kostenlos)](https://aistudio.google.com/app/apikey)
     - 👉 [Groq API-Schlüssel holen (Kostenlos)](https://console.groq.com/keys)
5. **[Chat öffnen & Grundlagen]** Klicke auf das 💬-Symbol im linken Ribbon-Menü, um die Chat-Ansicht zu öffnen und mit der KI zu interagieren, oder markiere Text im Editor und klicke mit der rechten Maustaste, um Schnellaktionen auszulösen.
6. **[Agentenmodus aktivieren]** Gib den Befehl `/mcp` im Chat ein oder öffne das Schnell-Popup-Menü, um den **🤖 Agentenmodus** zu aktivieren.
   - *Tipp: Der interne Lumina-Server, der für die autonomen Operationen des Agenten erforderlich ist, startet automatisch im Hintergrund.*
7. **Autonome Aufgaben erteilen:** Wenn der Agentenmodus aktiv ist, kannst du komplexe Anweisungen geben, z. B.: "Finde alle Notizen zum Thema 'Künstliche Intelligenz' in meinem Vault, fasse die wichtigsten Punkte zusammen und organisiere sie in einer neuen Notiz." Die KI bestimmt und führt autonom die zur Erledigung der Aufgabe erforderlichen Tools aus.

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
- **Offline-Sicherheit:** Unterstützt nativ lokale Embeddings (`ibm-granite`). Sofern kein Cloud-Modell ausgewählt ist, verlassen deine wertvollen Notizdaten dein Gerät niemals.
- **Vollständig automatisiert:** Keine Konfiguration erforderlich! Die Hintergrundindizierung startet leise im Moment der Aktivierung des Plugins und synchronisiert sich automatisch in Echtzeit (`watch`-Modus), wenn Notizen geändert werden.
</details>

<details>
<summary><b>⚡ Inline-Editor-KI (Schnellaktionen)</b></summary>

- **Beschreibung:** Transformiere Text sofort im Markdown-Editor, ohne deinen Schreibfluss zu unterbrechen. Handhabe problemlos Übersetzungen, Zusammenfassungen, Grammatikkorrekturen und detaillierte Erklärungen für markierten Text.
- **Verwendung:** Markiere den Text und führe Schnellaktionen über das Inline-Popup-Menü oder die Befehlspalette aus. *(💡 Tipp: Weise in den Obsidian-Einstellungen Hotkeys für blitzschnellen Zugriff zu!)*
</details>

<details>
<summary><b>🤖 Autonomer KI-Agent (Agentenmodus) ⚠️</b></summary>

- **Beschreibung:** Wenn aktiviert, bestimmt und orchestriert das LLM autonom MCP-Tools, um Aufgaben auszuführen. Es kann komplexe, mehrstufige Operationen abschließen, indem es Notizensuche, Lesen, Schreiben und RAG-Abrufe kombiniert.
- **Lokaler LLM-Support:** Implementiert einen dedizierten Parser, der textbasiertes Tool-Prompting unterstützt, sodass der Agent auch in lokalen LLM-Umgebungen reibungslos funktioniert, nicht nur bei leistungsstarken Cloud-Modellen.
- **Sicherheitsmechanismen:** Um Endlosschleifen oder übermäßige API-Kosten zu vermeiden, wird ein maximales Limit für Ausführungsschritte pro Anfrage (Standard: 15 Schritte) erzwungen. Die Ausführung wird bei Erkennung wiederholter Tool-Aufrufe automatisch abgebrochen.
- **Verwendung:** Gib den Befehl `/mcp` im Chat ein oder nutze das obere Symbol, um das Schnell-Popup zu öffnen und den 'Agentenmodus' zu aktivieren. (Der interne Lumina-Server startet nach Bedarf automatisch, um Tools auszuführen).
</details>

<details>
<summary><b>🤖 MCP-Integration (Bidirektionaler Client- & Server-Support) ⚠️</b></summary>

- **Beschreibung:** Überbrückt Obsidian nahtlos mit dem breiteren KI-Ökosystem über das Model Context Protocol (MCP). Nutze Obsidian als All-in-One-KI-Hub oder nutze es als das zweite Gehirn deiner KI!
- **💻 Client-Modus (Obsidian-gesteuert):**
  - Interagiere und arbeite direkt mit KI innerhalb von Obsidian.
  - Verbinde zahlreiche externe MCP-Server (GitHub, lokale Datenbanken, Web-Suche usw.), um sofort riesige Datenmengen zu scrapen und in deinen Notizen zu organisieren.
- **🖥️ Server-Modus (Externe KI-gesteuert):**
  - Stellt 7 Tools zur Verfügung, die externen KI-Assistenten (Claude, Cursor usw.) direkten Zugriff auf deinen Vault gewähren.
  - `read_active_note`, `read_note`, `search_notes`, `rag_search`: Bietet der KI den Kontext und das Wissen deines Vaults.
  - `create_note`, `append_to_note`: Erlaubt der KI, organisierte Ideen sicher direkt in deinen Vault zu schreiben (Überschreibschutz aktiv).
  - `read_daily_note`, `append_to_daily_note`: Lese-/Schreibintegration für die heutige Tagesnotiz.
- **Verwendung:** Aktiviere MCP-Funktionen in den Plugin-Einstellungen und konfiguriere die Client/Server-Transportmethode (SSE).
- **Hinweis:** *Agenten- und MCP-Funktionen befinden sich derzeit in der experimentellen Phase (Beta). Obwohl verschiedene Sicherheitsnetze wie Überschreibschutz und Zeichenbegrenzungen bestehen, empfehlen wir anfangs, Operationen genau zu überwachen, da externe KI deine Notizen direkt bearbeitet.*
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
Sponsoring hält mich motiviert, Updates noch schneller zu veröffentlichen!

👉 **[GitHub Sponsor](https://github.com/sponsors/lumina-apps)**  
👉 **[Ko-fi](https://ko-fi.com/luminaapps)**  
👉 **[Ctee](https://ctee.kr/place/luminaapps)**
