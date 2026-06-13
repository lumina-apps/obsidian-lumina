# 🚀 Lumina: Assistente IA All-in-One (RAG + MCP + Agent)

**`Lumina` è un potente plugin assistente all-in-one per Obsidian che trasforma la tua base di conoscenze in un hub IA completo combinando supporto multi-LLM, RAG senza configurazione, integrazione MCP bidirezionale e agenti IA autonomi.**

<p align="center">
  <a href="/README.md">English</a> | <a href="/docs/README_KO.md">한국어</a> | <a href="/docs/README_JA.md">日本語</a> | <a href="/docs/README_ZH.md">简体中文</a> | <a href="/docs/README_ZH_TW.md">繁體中文</a> | <a href="/docs/README_ES.md">Español</a> | <a href="/docs/README_DE.md">Deutsch</a> | <a href="/docs/README_FR.md">Français</a> | <a href="/docs/README_PT.md">Português</a> | <a href="/docs/README_RU.md">Русский</a> | <b>Italiano</b>
</p>

> 🌐 **Ottimizzato per Ambienti Multilingua!** I modelli di embedding integrati e l'interfaccia utente sono completamente localizzati per ambienti multilingue. (Il feedback sulle traduzioni è sempre benvenuto!)

![alt text](readme.gif)

---

## 🌟 Funzionalità Principali

| Funzionalità | Descrizione |
| :--- | :--- |
| **💬 Vista Chat Multi-LLM** | Un pannello laterale dedicato che comprende il contesto delle tue note. Supporta di tutto, da potenti modelli cloud fino a LLM locali per la massima privacy. |
| **🧠 RAG Zero-Config** | Dispone di embedding locali al 100% offline per prevenire perdite di dati. Indicizza automaticamente il tuo vault in tempo reale senza configurazioni complesse. |
| **⚡ Azioni Rapide IA Inline** | Evidenzia il testo nell'editor per riassumere, tradurre o correggere all'istante senza interrompere il tuo flusso di scrittura. |
| **🤖 Agente IA Autonomo** | I LLM pianificano ed eseguono autonomamente compiti complessi come la ricerca, la creazione e la modifica di note utilizzando strumenti MCP. (Sperimentale) |
| **🔌 Integrazione MCP (Client e Server)** | Un'integrazione full-stack bidirezionale che ti consente di utilizzare strumenti esterni all'interno di Obsidian (Client) o di far interagire IA esterne con le tue note (Server). (Sperimentale) |

---

## ⚡ Avvio Rapido

1. **Installa** e abilita `Lumina` dai Plugin della Community di Obsidian.
2. Una volta abilitato, il modello RAG integrato inizierà automaticamente ad analizzare le tue note in background. (La navigazione intelligente diventa disponibile nel pannello laterale).
3. **[Abilitare Chat IA]** Naviga in Impostazioni di Obsidian ➔ `Lumina`.
4. Aggiungi il tuo provider LLM preferito e inserisci le tue chiavi API.
   - 💻 **I LLM Locali (Ollama, LM Studio, ecc.)** possono essere connessi istantaneamente senza chiavi API!
   - ☁️ **I LLM Cloud** richiedono chiavi API, che possono essere facilmente ottenute gratuitamente:
     - 👉 [Ottieni Chiave API Google Gemini (Gratis)](https://aistudio.google.com/app/apikey)
     - 👉 [Ottieni Chiave API Groq (Gratis)](https://console.groq.com/keys)
5. **[Apri Chat e Uso Base]** Clicca sull'icona 💬 nel menu laterale sinistro per aprire la Vista Chat e iniziare a interagire con l'IA, oppure evidenzia il testo nell'editor e clicca col tasto destro per attivare le Azioni Rapide.
6. **[Abilita Modalità Agente]** Digita il comando `/mcp` nella chat o apri il menu rapido a comparsa per attivare la **🤖 Modalità Agente**.
   - *Suggerimento: Il server interno Lumina necessario per le operazioni autonome dell'agente si avvierà automaticamente in background.*
7. **Assegna Compiti Autonomi:** Con la Modalità Agente attiva, dai istruzioni complesse come, "Trova tutte le note relative all''Intelligenza Artificiale' nel mio vault, riassumi i punti chiave e organizzali in una nuova nota." L'IA determinerà ed eseguirà autonomamente gli strumenti necessari per completare l'attività.

> [!IMPORTANT]
> **🔒 Archiviazione Sicura delle Chiavi API**
> Tutte le chiavi API inserite non vengono mai memorizzate come file di testo in chiaro. Sono crittografate in modo sicuro e memorizzate localmente tramite il `SecretStorage` integrato in Obsidian, garantendo che i tuoi dati rimangano al sicuro.

---

## ✨ Funzionalità Dettagliate e Utilizzo (Clicca per Espandere)

<details>
<summary><b>💬 Vista Chat Multi-LLM (Supporto Cloud e Locale)</b></summary>

- **Descrizione:** Conversa all'istante con vari modelli IA tramite un pannello laterale dedicato all'interno di Obsidian. Supporta completamente modelli cloud potenti come Gemini e Groq, oltre a **LLM Locali** (Ollama, LM Studio, ecc.) per una privacy assoluta.
- **Come usare:** Clicca sull'icona 💬 sulla barra laterale o esegui `Lumina: Open Chat` dalla palette dei comandi.
- **💡 Suggerimento Pro:** Evidenzia il testo nell'editor, clicca col tasto destro e usa il menu contestuale per iniettare direttamente il testo selezionato nella chat come contesto per le tue domande!
</details>

<details>
<summary><b>🧠 Chat Basata su RAG ed Embedding Locali (Privacy Assoluta)</b></summary>

- **Descrizione:** L'IA ottiene una profonda comprensione della tua base di conoscenze. Cerca autonomamente note rilevanti durante le conversazioni e visualizza documenti simili e tag consigliati nel pannello laterale, creando collegamenti contestuali intelligenti.
- **Sicurezza Offline:** Supporta nativamente embedding locali (`ibm-granite`). A meno che non venga selezionato un modello cloud, i preziosi dati delle tue note non lasceranno mai il tuo dispositivo. *(⚠️ Gli embedding locali non sono supportati in ambienti mobili).*
- **Completamente Automatizzato:** Nessuna configurazione richiesta! L'indicizzazione in background inizia silenziosamente nel momento in cui il plugin viene abilitato, e si sincronizza automaticamente in tempo reale (modalità `watch`) ogni volta che le note vengono modificate.
</details>

<details>
<summary><b>⚡ IA Integrata nell'Editor (Azioni Rapide)</b></summary>

- **Descrizione:** Trasforma istantaneamente il testo all'interno dell'editor markdown senza interromper il tuo flusso di scrittura. Gestisci facilmente traduzioni, riassunti, correzioni grammaticali e spiegazioni dettagliate per il testo selezionato.
- **Come usare:** Evidenzia il testo ed esegui le Azioni Rapide tramite il menu a comparsa in linea o la palette dei comandi. *(💡 Suggerimento: Assegna tasti di scelta rapida nelle impostazioni di Obsidian per un accesso fulmineo!)*
</details>

<details>
<summary><b>🤖 Agente IA Autonomo (Modalità Agente) ⚠️</b></summary>

- **Descrizione:** Quando attivato, il LLM determina e orchestra autonomamente gli strumenti MCP per eseguire compiti. Può completare complesse operazioni in più passaggi combinando la ricerca, la lettura, la scrittura di note e il recupero RAG.
- **Supporto LLM Locale:** Implementa un parser dedicato che supporta il "tool prompting" basato sul testo, consentendo all'agente di funzionare senza problemi anche in ambienti LLM Locali, non solo con modelli cloud ad alte prestazioni.
- **Meccanismi di Sicurezza:** Per prevenire loop infiniti o costi API eccessivi, viene imposto un limite massimo di passaggi di esecuzione per richiesta (predefinito: 15 passaggi). L'esecuzione viene automaticamente interrotta se vengono rilevate chiamate ripetute agli strumenti.
- **Come usare:** Digita il comando `/mcp` nella chat o usa l'icona in alto per aprire il pop-up rapido e abilitare la 'Modalità Agente'. (Il server interno Lumina si avvierà automaticamente secondo necessità per eseguire gli strumenti).
</details>

<details>
<summary><b>🤖 Integrazione MCP (Supporto Bidirezionale Client e Server) ⚠️</b></summary>

- **Descrizione:** Collega senza soluzione di continuità Obsidian con il più ampio ecosistema IA tramite il Model Context Protocol (MCP). Usa Obsidian come un hub IA all-in-one, o sfruttalo come il secondo cervello della tua IA!
- **💻 Modalità Client (Guidata da Obsidian):**
  - Interagisci e lavora direttamente con l'IA all'interno di Obsidian.
  - Connetti numerosi server MCP esterni (GitHub, DB locali, ricerca web, ecc.) per raschiare (scrape) e organizzare all'istante grandi quantità di dati nelle tue note.
- **🖥️ Modalità Server (Guidata da IA Esterna):**
  - Espone 7 strumenti consentendo ad assistenti IA esterni (Claude, Cursor, ecc.) di accedere direttamente al tuo vault.
  - `read_active_note`, `read_note`, `search_notes`, `rag_search`: Fornisce all'IA il contesto e le conoscenze del tuo vault.
  - `create_note`, `append_to_note`: Consente all'IA di scrivere in sicurezza idee organizzate direttamente nel tuo vault (protezione da sovrascrittura applicata).
  - `read_daily_note`, `append_to_daily_note`: Integrazione lettura/scrittura per la nota quotidiana di oggi.
- **Come usare:** Abilita le funzioni MCP nelle impostazioni del plugin e configura il metodo di trasporto client/server (SSE).
- **Nota:** *Le funzioni Agente e MCP sono attualmente in fase Sperimentale (Beta). Sebbene esistano varie reti di sicurezza come la protezione da sovrascrittura e limiti di caratteri, si consiglia di monitorare da vicino le operazioni inizialmente, poiché IA esterne modificheranno direttamente le tue note.*
</details>

---

## 🐛 Modalità di Debug e Segnalazioni Bug

Puoi visualizzare tutti i dati interni elaborati dal plugin abilitando le Impostazioni Avanzate e attivando la [Modalità di Debug] sotto la scheda [Add-on & Varie] nelle impostazioni. (I log di debug non vengono salvati finché non vengono scaricati).

**💡 Informazioni Utili per la Risoluzione:**
- Il tuo Dispositivo/OS (PC / Mobile) e la versione di Obsidian.
- Il Provider IA e il Nome Modello utilizzato (es., OpenAI / gpt-4o, Ollama / llama3).
- Il file di log scaricato dopo che l'errore si è verificato in Modalità di Debug.
> [!IMPORTANT]
> Poiché i file di log potrebbero contenere trascrizioni delle chat, rimuovi qualsiasi informazione sensibile prima dell'invio.
> **[Segnala un Bug (GitHub Issues)](https://github.com/lumina-apps/obsidian-lumina/issues)**

---

## ☕ Supporto e Sponsorizzazione

Questo plugin è distribuito al 100% gratuitamente e sarà costantemente aggiornato.
Le sponsorizzazioni mi mantengono motivato per rilasciare aggiornamenti ancora più velocemente!

👉 **[GitHub Sponsor](https://github.com/sponsors/lumina-apps)**  
👉 **[Ko-fi](https://ko-fi.com/luminaapps)**  
👉 **[Ctee](https://ctee.kr/place/luminaapps)**
