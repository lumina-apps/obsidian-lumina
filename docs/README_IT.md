# 🚀 Lumina: Assistente IA All-in-One (RAG + MCP + Agent)

**`Lumina` è un potente plugin assistente all-in-one per Obsidian che trasforma la tua base di conoscenze in un hub IA completo combinando supporto multi-LLM, RAG senza configurazione, integrazione MCP bidirezionale e agenti IA autonomi.**

<p align="center">
  <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/README.md">English</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_KO.md">한국어</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_JA.md">日本語</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ZH.md">简体中文</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ZH_TW.md">繁體中文</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ES.md">Español</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_DE.md">Deutsch</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_FR.md">Français</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_PT.md">Português</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_RU.md">Русский</a> | <b>Italiano</b>
</p>

> 🌐 **Ottimizzato per Ambienti Multilingua!** I modelli di embedding integrati e l'interfaccia utente sono completamente localizzati per ambienti multilingue. (Il feedback sulle traduzioni è sempre benvenuto!)

![alt text](readme.gif)

---

## 🌟 Funzionalità Principali

| Funzionalità | Descrizione |
| :--- | :--- |
| **💬 Vista Chat Multi-LLM** | Un pannello laterale dedicato che comprende il contesto delle tue note. Supporta di tutto, da potenti modelli cloud fino a LLM locali per la massima privacy. |
| **🧠 RAG Zero-Config** | Dispone di embedding locali al 100% offline per prevenire perdite di dati. Indicizza automaticamente il tuo vault in tempo reale senza configurazioni complesse. |
| **🔗 Smart Discovery** | Trova istantaneamente documenti altamente rilevanti per la nota in corso di scrittura tramite ricerca semantica, rileva e avverte di potenziali duplicati e inserisce tag consigliati e collegamenti correlati con un solo clic. |
| **⚡ Azioni Rapide IA Inline** | Evidenzia il testo nell'editor per riassumere, tradurre o correggere all'istante senza interrompere il tuo flusso di scrittura. |
| **🚀 Modalità Agente Intelligente** | L'IA pianifica ed esegue autonomamente compiti complessi come la ricerca, la creazione, la modifica, l'eliminazione/spostamento di note e l'esecuzione di codice in una sandbox utilizzando 25 strumenti MCP integrati. |
| **🔌 Integrazione MCP (Client & Server)** | Un'integrazione bidirezionale full-stack che consente di utilizzare strumenti esterni all'interno di Obsidian (Client) o consentire a IA esterne di interagire con le note (Server). |

---

## ⚡ Avvio Rapido

Lumina offre due modalità in base al tuo livello di competenza. Scegli quella che preferisci!

### 🟢 Traccia 1: Inizia in 3 passi (Consigliato per Principianti)
1. Installa e abilita Lumina.
2. Vai su Impostazioni > Lumina e inserisci la tua **chiave API gratuita (Gemini o Groq)** ottenuta dai link sottostanti.
   - 👉 [Ottieni Chiave API Google Gemini (Gratis)](https://aistudio.google.com/app/apikey)
   - 👉 [Ottieni Chiave API Groq (Gratis)](https://console.groq.com/keys)
3. Apri una qualsiasi nota e fai una domanda a Lumina nel pannello laterale destro. Tutto qui! (Una volta completata l'indicizzazione RAG locale nel pannello laterale, le conversazioni basate sulle tue note verranno immediatamente attivate.)

### 🔵 Traccia 2: Padroneggia l'Agente (Consigliato per Utenti Avanzati)
1. Collega un LLM locale o la tua IA cloud preferita nelle impostazioni.
2. Digita `/mcp` nella chat per attivare la **Modalità Agente Intelligente**.
3. Dai comandi autonomi come: "Trova tutti i verbali delle riunioni di questa settimana nel mio vault e compilali in un unico file di riepilogo."

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
- **Sicurezza offline:** Il sistema RAG di Lumina utilizza embedding locali al 100% offline (modello di embedding multilingue integrato `ibm-granite`) per analizzare le note. A meno che non sia selezionato un modelo cloud, i preziosi dati delle tue note non lasceranno mai il tuo dispositivo.
- **Completamente Automatizzato:** Nessuna configurazione richiesta! L'indicizzazione in background inizia silenziosamente nel momento in cui il plugin viene abilitato, e si sincronizza automaticamente in tempo reale (modalità `watch`) ogni volta che le note vengono modificate.
</details>

<details>
<summary><b>🔗 Smart Discovery</b></summary>

- **Descrizione:** Basato sul motore RAG, visualizza le informazioni altamente rilevanti per la nota in corso di scrittura direttamente nella scheda "Smart Discovery" del pannello laterale.
- **Caratteristiche principali:**
  - **Ricerca semantica:** Va oltre la semplice corrispondenza delle parole chiave, analizzando il contesto e il significato della frase inserita per cercare note simili.
  - **Rilevamento duplicati:** Mostra un avviso se nel vault esiste già un documento con contenuti molto simili per evitare la frammentazione e la duplicazione delle informazioni.
  - **Tag consigliati e note correlate:** Analizza il contesto della nota in corso per consigliare tag appropriati e suggerire note correlate in tempo reale.
  - **Integrazione e chat con un clic:** Inserisci i tag consigliati o le note correlate nel tuo documento come tag o collegamenti markdown (`[[Nome nota]]`) con un solo clic, oppure inserisci le note selezionate nell'area di staging per avviare immediatamente una chat AI.
  - **Come usare:** Fai clic sull'icona 💬 sulla barra multifunzione a sinistra per aprire il pannello laterale e passa alla scheda 🔗 (Smart Discovery) in alto.
</details>

<details>
<summary><b>⚡ IA Integrata nell'Editor (Azioni Rapide)</b></summary>

- **Descrizione:** Trasforma istantaneamente il testo all'interno dell'editor markdown senza interromper il tuo flusso di scrittura. Gestisci facilmente traduzioni, riassunti, correzioni grammaticali e spiegazioni dettagliate per il testo selezionato.
- **Come usare:** Evidenzia il testo ed esegui le Azioni Rapide tramite il menu a comparsa in linea o la palette dei comandi. *(💡 Suggerimento: Assegna tasti di scelta rapida nelle impostazioni di Obsidian per un accesso fulmineo!)*
</details>

<details>
<summary><b>🚀 Modalità Agente Intelligente</b></summary>

- **Descrizione:** Quando attivata, l'LLM determina e orchestra autonomamente 25 strumenti MCP integrati per eseguire attività. Può completare complesse operazioni in più passaggi combinando la ricerca, la lettura e la scrittura di note, il recupero RAG, l'esecuzione di codice in una sandbox e l'integrazione delle note giornaliere.
- **Supporto LLM locale:** Implementa un parser dedicato che supporta il prompt degli strumenti basato su testo, consentendo all'agente di funzionare senza problemi anche in ambienti LLM locali, non solo con modelli cloud ad alte prestazioni.
- **Sicurezza robusta e controllo utente (Human-in-the-Loop):** Le operazioni distruttive come la modifica dei contenuti, l'eliminazione di file o l'esecuzione di codice non possono essere elaborate dall'agente da solo. Vengono eseguite in sicurezza con backup di protezione contro la sovrascrittura solo dopo aver mostrato all'utente un'interfaccia utente (visualizzatore di differenze e finestra di avviso dell'attività) e aver ricevuto l'approvazione finale (Accetta).
- **Prevenzione dei costi e limiti:** Vengono applicati limiti predefiniti sul numero di utilizzi degli strumenti e sulla lunghezza dei caratteri aggiunti per prevenire malfunzionamenti dell'IA o cicli infiniti. (Questi limiti possono essere regolati liberamente nelle impostazioni avanzate).
- **Come usare:** Digita il comando `/mcp` nella chat o usa l'icona in alto per aprire il popup rapido e abilitare la 'Modalità Agente'. (Le server interno di Lumina si avvierà automaticamente secondo necessità per eseguire gli strumenti).
</details>

<details>
<summary><b>🔌 Integrazione MCP (Supporto bidirezionale client & server)</b></summary>

- **Descrizione:** Collega senza soluzione di continuità Obsidian con il più ampio ecosistema IA tramite il Model Context Protocol (MCP). Usa Obsidian come un hub IA all-in-one, o sfruttalo come il secondo cervello della tua IA!
- **💻 Modalità Client (Guidata da Obsidian):**
  - Interagisci e lavora direttamente con l'IA all'interno di Obsidian.
  - Connetti numerosi server MCP esterni (GitHub, DB locali, ricerca web, ecc.) per raschiare (scrape) e organizzare all'istante grandi quantità di dati nelle tue note.
- **🖥️ Modalità Server (Guidata da IA Esterna):**
  - Fornisce 25 strumenti che consentono agli assistenti IA esterni (Claude, Cursor, etc.) o all'IA in Modalità Agente di accedere direttamente al tuo vault.
  - **Ricerca Web:** `lumina_web_search` (Ricerca di informazioni su Internet in tempo reale utilizzando vari motori di ricerca come Tavily, Exa, Google, con supporto di troncamento intelligente)
  - **Lettura e Ricerca:** `read_active_note`, `read_note`, `search_notes` (supporta il filtraggio per tag), `list_notes`, `rag_search`, `get_backlinks`, `get_note_metadata`, `list_attachments`, `list_tags` per fornire un ampio contesto all'IA.
  - **Scrittura e Modifica:** `create_note`, `append_to_note`, `replace_note`, `patch_note`, `update_frontmatter`, `save_attachment`, `create_canvas`, `generate_moc`, `auto_link_note` (creazione/modifica di note/canvas, generazione di note MOC (Map of Content) e salvataggio di file binari).
  - **Gestione ed Esecuzione:** `delete_note`, `move_note` (sposta/rinomina), `execute_code`, `run_note_code_block` (esecuzione di codice all'interno di una sandbox).
- **Nota:** *Lumina è dotato di meccanismi di sicurezza a più livelli tra cui l'esecuzione di codice in sandbox, approvazioni dell'utente basate su un visualizzatore di differenze in tempo reale (Human-in-the-Loop), backup automatici durante le modifiche ai file (protezione da sovrascrittura) e limiti per prevenire cicli infiniti. Tuttavia, poiché l'agente e le IA esterne accedono direttamente al tuo vault, consigliamo inizialmente di monitorare attentamente le operazioni.*
  - **Sicurezza Robusta e Controllo Utente:** Operazioni distruttive come la modifica del contenuto, l'eliminazione di file o l'esecuzione di codice non possono essere elaborate dall'agente da solo. Vengono eseguite in sicurezza con backup di protezione da sovrascrittura solo dopo aver mostrato all'utente un'interfaccia (Visualizzatore di Differenze e Modale di Avviso Attività) e aver ricevuto l'approvazione finale (Accept).
- **Come usare:** Abilita le funzioni MCP nelle impostazioni del plugin e configura il metodo di trasporto client/server (SSE).
- **Nota:** *Lumina è dotato di meccanismi di sicurezza a più livelli tra cui l'esecuzione di codice in sandbox, approvazioni dell'utente basate su un visualizzatore di differenze in tempo reale (Human-in-the-Loop), backup automatici durante le modifiche ai file (protezione da sovrascrittura) e limiti per prevenire cicli infiniti. Tuttavia, poiché l'agente e le IA esterne accedono direttamente al tuo vault, consigliamo inizialmente di monitorare attentamente le operazioni.*
</details>

---

## 🐛 Modalità di Debug e Segnalazioni Bug

Puoi visualizzare tutti i dati interni elaborati dal plugin abilitando le Impostazioni Avanzate e attivando la [Modalità di Debug] sotto la scheda [Add-on & Varie] nelle impostazioni. (I log di debug non vengono salvati finché non vengono scaricati).

**💡 Informazioni Utili per la Risoluzione:**
- Il tuo sistema operativo (Windows, macOS, Linux) e la versione di Obsidian.
- Il Provider IA e il Nome Modello utilizzato (es., OpenAI / gpt-4o, Ollama / llama3).
- Il file di log scaricato dopo che l'errore si è verificato in Modalità di Debug.
> [!IMPORTANT]
> Poiché i file di log potrebbero contenere trascrizioni delle chat, rimuovi qualsiasi informazione sensibile prima dell'invio.
> **[Segnala un Bug (GitHub Issues)](https://github.com/lumina-apps/obsidian-lumina/issues)**

---

## ☕ Supporto e Sponsorizzazione

Questo plugin è distribuito al 100% gratuitamente e sarà costantemente aggiornato.

👉 **[Ko-fi](https://ko-fi.com/luminaapps)**  
👉 **[Ctee](https://ctee.kr/place/luminaapps)**