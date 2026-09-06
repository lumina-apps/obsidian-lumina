# Lumina: Assistente IA All-in-One (RAG + MCP + Agenti CLI)

**`Lumina` è un potente plugin assistente all-in-one per Obsidian che trasforma la tua base di conoscenze in un hub IA completo combinando supporto multi-LLM (cloud e locale), integrazione di agenti CLI da terminale (Claude Code, Antigravity, OpenCode, Codex), RAG senza configurazione, integrazione MCP bidirezionale e agenti IA autonomi.**

<p align="center">
  <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/README.md">English</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_KO.md">한국어</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_JA.md">日本語</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ZH.md">简体中文</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ZH_TW.md">繁體中文</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ES.md">Español</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_DE.md">Deutsch</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_FR.md">Français</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_PT.md">Português</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_RU.md">Русский</a> | <b>Italiano</b>
</p>

> **Ottimizzato per Ambienti Multilingua!** I modelli di embedding integrati e l'interfaccia utente sono completamente localizzati per ambienti multilingue. (Il feedback sulle traduzioni è sempre benvenuto!)

![alt text](readme.gif)

---

## Funzionalità Principali

| Funzionalità | Descrizione |
| :--- | :--- |
| **Vista Chat Multi-LLM** | Un pannello laterale dedicato che comprende il contesto delle tue note. Supporta di tutto, da potenti modelli cloud fino a LLM locali per la massima privacy. |
| **Integrazione Agenti CLI da Terminale** | Esegui gli agenti IA ufficiali da terminale (Claude Code, Antigravity, OpenCode, Codex) nel pannello laterale di Obsidian con flusso di pensiero in tempo reale e modalità sicure di sola lettura o modifica. |
| **RAG Zero-Config** | Dispone di embedding locali al 100% offline per prevenire perdite di dati. Indicizza automaticamente il tuo vault in tempo reale senza configurazioni complesse. |
| **Smart Discovery** | Trova istantaneamente documenti altamente rilevanti per la nota in corso di scrittura tramite ricerca semantica, rileva e avverte di potenziali duplicati e inserisce tag consigliati e collegamenti correlati con un solo clic. |
| **Azioni Rapide IA Inline** | Evidenzia il testo nell'editor per riassumere, tradurre o correggere all'istante senza interrompere il tuo flusso di scrittura. |
| **Modalità Agente Intelligente** | L'IA pianifica ed esegue autonomamente compiti complessi come la ricerca, la creazione, la modifica, l'eliminazione/spostamento di note e l'esecuzione di codice in una sandbox utilizzando vari strumenti MCP integrati. |
| **Integrazione MCP (Client & Server)** | Un'integrazione bidirezionale full-stack che consente di utilizzare strumenti esterni all'interno di Obsidian (Client) o consentire a IA esterne di interagire con le note (Server). |

---

## Avvio Rapido

Lumina offre due modalità in base al tuo livello di competenza. Scegli quella che preferisci!

### Traccia 1: Inizia in 3 passi (Consigliato per Principianti)
1. Installa e abilita Lumina.
2. Vai su Impostazioni > Lumina e inserisci la tua **chiave API gratuita (Gemini o Groq)** ottenuta dai link sottostanti.
   - [Ottieni Chiave API Google Gemini (Gratis)](https://aistudio.google.com/app/apikey)
   - [Ottieni Chiave API Groq (Gratis)](https://console.groq.com/keys)
3. Apri una qualsiasi nota e fai una domanda a Lumina nel pannello laterale destro. Tutto qui! (Una volta completata l'indicizzazione RAG locale nel pannello laterale, le conversazioni basate sulle tue note verranno immediatamente attivate.)

### Traccia 2: Padroneggia l'Agente (Consigliato per Utenti Avanzati)
1. Collega un LLM locale o la tua IA cloud preferita nelle impostazioni.
2. Digita `/mcp` nella chat per attivare la **Modalità Agente Intelligente**.
3. Dai comandi autonomi come: "Trova tutti i verbali delle riunioni di questa settimana nel mio vault e compilali in un unico file di riepilogo."

> [!IMPORTANT]
> **Archiviazione Sicura delle Chiavi API**
> Tutte le chiavi API inserite non vengono mai memorizzate come file di testo in chiaro. Sono crittografate in modo sicuro e memorizzate localmente tramite il `SecretStorage` integrato in Obsidian, garantendo che i tuoi dati rimangano al sicuro.

---

## Funzionalità Dettagliate e Utilizzo (Clicca per Espandere)
<details>
<summary><b>Vista Chat Multi-LLM (Supporto Cloud e Locale)</b></summary>

- **Descrizione:** Conversa all'istante con vari modelli IA tramite un pannello laterale dedicato all'interno di Obsidian. Supporta completamente modelli cloud potenti come Gemini e Groq, oltre a **LLM Locali** (Ollama, LM Studio, ecc.) per una privacy assoluta.
- **Come usare:** Clicca sull'icona di chat sulla barra laterale o esegui `Lumina: Open Chat` dalla palette dei comandi.
- **Suggerimento Pro:** Evidenzia il testo nell'editor, clicca col tasto destro e usa il menu contestuale per iniettare direttamente il testo selezionato nella chat come contesto per le tue domande!
</details>

<details>
<summary><b>Integrazione Agenti CLI da Terminale (Claude Code, Antigravity, OpenCode, Codex)</b></summary>

- **Descrizione:** Esegui e coordina agenti IA da terminale direttamente nel pannello laterale di Obsidian per esplorare, analizzare e gestire le note del tuo vault.
- **Agenti Supportati:** Anthropic **Claude Code**, Google **Antigravity**, **OpenCode** e OpenAI **Codex**.
- **Caratteristiche Principali:**
  - **Interruttore di Sicurezza Sola Lettura / Modifica:** Passa con un solo clic nella barra degli strumenti della chat tra la modalità 👁️ **Sola Lettura** (ispeziona e analizza in sicurezza le note senza modificare i file) e la modalità ✏️ **Modifica**.
  - **Pensiero Visivo (Thinking):** Trasmette e visualizza il processo di ragionamento interno dell'agente CLI in blocchi di pensiero ripiegabili in tempo reale.
  - **Stato in Tempo Reale e File Modificati:** Mostra lo stato di esecuzione degli strumenti in tempo reale e fornisce badge cliccabili per aprire istantaneamente i file modificati dall'agente.
  - **Contesto Nota Attiva e Media:** Invia automaticamente la nota attiva e le immagini/file allegati nel prompt della CLI per conversazioni contestuali fluide.
  - **Sincronizzazione MCP per Terminale Esterno (Opzionale):** Genera file di configurazione (`.claude/mcp.json`, `opencode.json`, `codex.json`) nel tuo vault, consentendo anche alle sessioni CLI eseguite nel terminale di sistema di accedere agli strumenti MCP di Lumina.
- **Come usare:** In Impostazioni Lumina > Connessioni (Connections), seleziona il provider CLI preferito, configura il percorso del file binario e inizia a chattare nel pannello laterale.
</details>

<details>
<summary><b>Chat Basata su RAG ed Embedding Locali (Privacy Assoluta)</b></summary>

- **Descrizione:** L'IA acquisisce una profonda comprensione della tua base di conoscenza. Cerca autonomamente le note rilevanti durante le conversazioni e mostra documenti simili e tag consigliati nel pannello laterale, creando connessioni contestuali intelligenti.
- **Sicurezza Offline:** Il sistema RAG di Lumina utilizza embedding locali al 100% offline (modello di embedding multilingue integrato `ibm-granite`) per analizzare le tue note. A meno che non venga selezionato un modello cloud, i preziosi dati delle tue note non lasceranno mai il tuo dispositivo.
- **Completamente Automatizzato:** Nessuna configurazione richiesta! L'indicizzazione in background si avvia silenziosamente all'abilitazione del plugin e si sincronizza automaticamente in tempo reale (modalità `watch`) ogni volta che le note vengono modificate.
</details>

<details>
<summary><b>Smart Discovery</b></summary>

- **Descrizione:** Basato sul motore RAG, visualizza informazioni altamente rilevanti per la nota in fase di scrittura direttamente nella scheda "Smart Discovery" del pannello laterale.
- **Caratteristiche Principali:**
  - **Ricerca Semantica:** Va oltre la semplice corrispondenza delle parole chiave, analizzando contesto e significato per cercare note simili.
  - **Rilevamento Duplicati:** Avvisa se esiste già un documento molto simile nel vault per evitare frammentazione.
  - **Tag Consigliati e Note Correlate:** Suggerisce tag appropriati e note correlate in tempo reale.
  - **Integrazione con un Clic:** Inserisci tag consigliati o collegamenti (`[[Nome Nota]]`) con un solo clic o avvia direttamente una chat IA.
- **Come usare:** Fai clic sull'icona di chat nella barra laterale sinistra e passa alla scheda Smart Discovery in alto.
</details>

<details>
<summary><b>IA Inline nell'Editor (Azioni Rapide)</b></summary>

- **Descrizione:** Trasforma istantaneamente il testo nell'editor Markdown (traduci, riassumi, correggi grammatica).
- **Come usare:** Evidenzia il testo ed esegui le Azioni Rapide dal menu a comparsa o dalla palette dei comandi.
</details>

<details>
<summary><b>Modalità Agente Intelligente</b></summary>

- **Descrizione:** Quando attivato, l'LLM determina e orchestra autonomamente vari strumenti MCP integrati per eseguire attività. Può completare operazioni complesse e in più fasi combinando ricerca, lettura e scrittura di note, recupero RAG, esecuzione di codice in sandbox e integrazione con le note giornaliere.
- **Supporto LLM Locale:** Implementa un parser dedicato che supporta il prompting degli strumenti basato su testo, consentendo all'agente di funzionare senza problemi anche in ambienti LLM locali, non solo con modelli cloud ad alte prestazioni.
- **Sicurezza Robusta e Controllo Utente (Human-in-the-Loop):** Le operazioni distruttive come la modifica del contenuto, l'eliminazione di file o l'esecuzione di codice non possono essere elaborate dall'agente da solo. Le modifiche ai file richiedono una **revisione Diff in linea** nell'editor con accettazione/rifiuto per singoli blocchi, mentre azioni sensibili come la creazione, l'eliminazione di file o l'esecuzione di codice richiedono un'approvazione esplicita tramite **schede di approvazione in linea** nel pannello di chat. (Backup automatici con protezione da sovrascrittura inclusi)
- **Prevenzione dei Costi e Limiti:** Vengono applicati limiti predefiniti sul numero di chiamate agli strumenti e sulla lunghezza dei caratteri aggiunti per prevenire malfunzionamenti dell'IA o cicli infiniti. (Questi limiti possono essere regolati liberamente dall'utente nelle impostazioni avanzate).
- **Come usare:** Digita il comando `/mcp` nella chat o usa l'icona in alto per aprire il popup rapido e attivare la "Modalità Agente". (Il server interno di Lumina si avvierà automaticamente secondo necessità per eseguire gli strumenti).
</details>

<details>
<summary><b>Integrazione MCP (Supporto bidirezionale client & server)</b></summary>

- **Descrizione:** Collega senza soluzione di continuità Obsidian con il più ampio ecosistema IA tramite il Model Context Protocol (MCP). Usa Obsidian come un hub IA all-in-one, o sfruttalo come il secondo cervello della tua IA!
- **Modalità Client (Guidata da Obsidian):**
  - Interagisci e lavora direttamente con l'IA all'interno di Obsidian.
  - Connetti numerosi server MCP esterni (GitHub, DB locali, ricerca web, ecc.) per raccogliere e organizzare all'istante grandi quantità di dati nelle tue note.
- **Modalità Server (Guidata da IA Esterna):**
  - Fornisce vari strumenti che consentono agli assistenti IA esterni (Claude, Cursor, ecc.) o all'IA in Modalità Agente di accedere direttamente al tuo vault e a Internet.
  - **Ricerca Web:** `lumina_web_search` (Cerca informazioni su Internet in tempo reale utilizzando vari motori di ricerca come Tavily, Exa, Google, con supporto di troncamento intelligente per risparmiare token).
  - **Lettura e Ricerca:** `read_active_note`, `read_note` (supporta intervalli di righe `startLine`/`endLine`), `search_notes` (supporta il filtraggio per tag), `grep_search` (ricerca regex/testo con numeri di riga nei file del vault), `glob_files` (corrispondenza percorsi con caratteri jolly, es. `**/*.md`), `list_notes`, `rag_search`, `get_backlinks`, `get_note_metadata`, `list_attachments`, `list_tags`, `query_metadata` per fornire un ampio contesto all'IA.
  - **Scrittura e Modifica:** `create_note`, `append_to_note`, `replace_note`, `patch_note`, `update_frontmatter`, `save_attachment`, `create_canvas`, `generate_moc`, `auto_link_note` (creazione/modifica di note/canvas, generazione di note MOC (Map of Content), collegamento automatico dei riferimenti e salvataggio di file binari).
  - **Gestione ed Esecuzione:** `open_note` (apertura istantanea di note/file nella scheda dell'editor di Obsidian), `delete_note`, `move_note` (sposta/rinomina), `execute_code`, `run_note_code_block` (esecuzione di codice all'interno di una sandbox), `run_shell_command` (esecuzione di comandi shell da terminale su SO desktop), `show_notice` (visualizzazione di notifiche toast di Obsidian).
  - **Note Giornaliere:** `read_daily_note`, `append_to_daily_note` (integrazione lettura/scrittura per la nota del giorno).
  - **Sincronizzazione MCP per Terminale CLI Esterno:** Genera opzionalmente le configurazioni del server MCP locale (`.claude/mcp.json`, `opencode.json`, `codex.json`) in modo che gli strumenti CLI nei terminali esterni possano accedere agli strumenti del vault di Lumina.
  - **Sicurezza del Vault e Controllo Utente (Human-in-the-Loop):** Schede di approvazione in linea per azioni sensibili, revisione Diff in linea nell'editor durante la modifica dei file, backup automatici con protezione da sovrascrittura ed esecuzione del codice isolata in sandbox.
- **Come usare:** Abilita le funzioni MCP nelle impostazioni del plugin e configura il metodo di trasporto client/server (SSE).
- **Nota:** *Lumina è dotato di meccanismi di sicurezza a più livelli, tra cui l'esecuzione di codice in sandbox, la revisione Diff in linea e l'approvazione dell'utente (Human-in-the-Loop), backup automatici durante le modifiche ai file (protezione da sovrascrittura) e limiti per prevenire cicli infiniti e chiamate incontrollate agli strumenti. Tuttavia, poiché l'agente e le IA esterne accedono direttamente al tuo vault, consigliamo inizialmente di monitorare attentamente le operazioni.*
</details>

---

## Modalità di Debug e Segnalazioni Bug

Puoi visualizzare tutti i dati interni elaborati dal plugin abilitando le Impostazioni Avanzate e attivando la [Modalità di Debug] sotto la scheda [Varie ed Estensioni] nelle impostazioni. (I log di debug non vengono salvati finché non vengono scaricati).

**Informazioni Utili per la Risoluzione:**
- Il tuo sistema operativo (Windows, macOS, Linux) e la versione di Obsidian.
- Il Provider IA e il Nome Modello utilizzato (es., OpenAI / gpt-4o, Ollama / llama3).
- Il file di log scaricato dopo che l'errore si è verificato in Modalità di Debug.
> [!IMPORTANT]
> Poiché i file di log potrebbero contenere trascrizioni delle chat, rimuovi qualsiasi informazione sensibile prima dell'invio.
> **[Segnala un Bug (GitHub Issues)](https://github.com/lumina-apps/obsidian-lumina/issues)**

---

## Supporto e Sponsorizzazione

Questo plugin è distribuito al 100% gratuitamente e sarà costantemente aggiornato.

**[Ko-fi](https://ko-fi.com/luminaapps)**  
**[Ctee](https://ctee.kr/place/luminaapps)**