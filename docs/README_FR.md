# Lumina : Assistant IA Tout-en-Un (RAG + MCP + Agents CLI)

**`Lumina` est un puissant plugin assistant tout-en-un pour Obsidian qui transforme votre base de connaissances en un véritable hub IA, combinant la prise en charge multi-LLM (cloud et locale), l'intégration d'agents CLI de terminal (Claude Code, Antigravity, OpenCode, Codex), un RAG sans configuration, une intégration MCP bidirectionnelle et des agents IA autonomes.**

<p align="center">
  <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/README.md">English</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_KO.md">한국어</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_JA.md">日本語</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ZH.md">简体中文</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ZH_TW.md">繁體中文</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ES.md">Español</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_DE.md">Deutsch</a> | <b>Français</b> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_PT.md">Português</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_RU.md">Русский</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_IT.md">Italiano</a>
</p>

> **Optimisé pour les Environnements Multilingues !** Les modèles d'intégration (embeddings) intégrés et l'interface utilisateur sont entièrement localisés pour les environnements multilingues. (Les retours sur la traduction sont toujours les bienvenus !)

![alt text](readme.gif)

---

## Fonctionnalités Principales

| Fonctionnalité | Description |
| :--- | :--- |
| **Vue de Chat Multi-LLM** | Un panneau latéral dédié qui comprend le contexte de vos notes. Prend en charge des modèles cloud puissants jusqu'aux LLM locaux pour un maximum de confidentialité. |
| **Intégration d'Agents CLI de Terminal** | Exécutez les agents IA de terminal officiels (Claude Code, Antigravity, OpenCode, Codex) directement dans le panneau latéral d'Obsidian pour explorer et organiser vos notes avec flux de pensée en temps réel et modes de sécurité. |
| **RAG Sans Configuration** | Propose des intégrations locales (embeddings) 100% hors ligne pour éviter les fuites de données. Indexe automatiquement votre coffre-fort en temps réel sans configurations complexes. |
| **Smart Discovery** | Trouve instantanément des documents hautement pertinents pour la note en cours de rédaction grâce à la recherche sémantique, détecte et signale les doublons potentiels, et insère des tags recommandés et des liens associés en un clic. |
| **Actions Rapides IA en Ligne** | Surlignez du texte dans l'éditeur pour résumer, traduire ou corriger instantanément, sans interrompre votre flux de rédaction. |
| **Mode Agent Intelligent** | Les LLM planifient et exécutent de manière autonome des tâches complexes telles que la recherche, la création, la modification, la suppression/déplacement de notes et l'exécution de code dans un bac à sable en utilisant divers outils MCP intégrés. |
| **Intégration MCP (Client & Serveur)** | Une intégration bidirectionnelle et complète (full-stack) qui vous permet d'utiliser des outils externes dans Obsidian (Client) ou de laisser des IA externes interagir avec vos notes (Serveur). |

---

## Démarrage Rapide

Lumina propose deux modes adaptés à votre niveau. Choisissez celui qui vous convient !

### Piste 1 : Démarrez en 3 étapes (Recommandé pour les Débutants)
1. Installez et activez Lumina.
2. Allez dans Paramètres > Lumina et saisissez votre **clé API gratuite (Gemini ou Groq)** obtenue via les liens ci-dessous.
   - [Obtenir une Clé API Google Gemini (Gratuit)](https://aistudio.google.com/app/apikey)
   - [Obtenir une Clé API Groq (Gratuit)](https://console.groq.com/keys)
3. Ouvrez n'importe quelle note et posez une question à Lumina dans le panneau latéral droit. C'est tout ! (Une fois l'indexation RAG locale terminée dans le panneau latéral, les conversations basées sur vos notes seront immédiatement activées.)

### Piste 2 : Maîtrisez l'Agent (Recommandé pour les Utilisateurs Avancés)
1. Connectez un LLM local ou votre IA cloud préférée dans les paramètres.
2. Tapez `/mcp` dans le chat pour activer le **Mode Agent Intelligent**.
3. Donnez des commandes autonomes comme : « Trouve tous les comptes rendus de réunion de cette semaine dans mon coffre et compile-les en un seul fichier de résumé. »

> [!IMPORTANT]
> **Stockage Sécurisé des Clés API**
> Toutes les clés API que vous entrez ne sont jamais stockées sous forme de fichiers texte en clair. Elles sont cryptées de manière sécurisée et stockées localement via le `SecretStorage` intégré d'Obsidian, garantissant ainsi la sécurité de vos données.

---

## Fonctionnalités Détaillées & Utilisation (Cliquez pour Développer)
<details>
<summary><b>Vue de Chat Multi-LLM (Prise en charge Cloud & Locale)</b></summary>

- **Description :** Discutez instantanément avec divers modèles d'IA via un panneau latéral dédié à l'intérieur d'Obsidian. Prend entièrement en charge des modèles cloud puissants comme Gemini et Groq, ainsi que des **LLM Locaux** (Ollama, LM Studio, etc.) pour une confidentialité absolue.
- **Comment utiliser :** Cliquez sur l'icône de chat sur le ruban gauche ou exécutez `Lumina: Open Chat` depuis la palette de commandes.
- **Astuce Pro :** Surlignez du texte dans l'éditeur, faites un clic droit, et utilisez le menu contextuel pour injecter directement le texte sélectionné dans le chat comme contexte pour vos questions !
</details>

<details>
<summary><b>Intégration d'Agents CLI de Terminal (Claude Code, Antigravity, OpenCode, Codex)</b></summary>

- **Description :** Exécutez et orchestrez des agents IA de terminal directement dans le panneau latéral d'Obsidian pour explorer, analyser et organiser les notes de votre coffre.
- **Agents Pris en Charge :** Anthropic **Claude Code**, Google **Antigravity**, **OpenCode**, OpenAI **Codex**.
- **Fonctionnalités Clés :**
  - **Basculement de Sécurité Lecture Seule / Édition :** Basculez en un clic sur la barre d'outils du chat entre le mode 👁️ **Lecture Seule** (consultez et analysez les notes en toute sécurité sans modifier les fichiers) et le mode ✏️ **Édition**.
  - **Pensée Visuelle (Thinking) :** Visualisez le raisonnement interne de l'agent CLI dans des blocs de pensée repliables en temps réel.
  - **Statut en Temps Réel & Fichiers Modifiés :** Affiche le statut d'exécution des outils en temps réel et fournit des badges cliquables pour ouvrir instantanément les fichiers modifiés par l'agent.
  - **Contexte Automatique de la Note Active et des Fichiers :** Transmet automatiquement la note active et les images/fichiers joints au prompt CLI pour des conversations contextuelles fluides.
  - **Synchronisation MCP pour Terminal Externe (Optionnel) :** Génère des fichiers de configuration (`.claude/mcp.json`, `opencode.json`, `codex.json`) dans votre coffre afin que les sessions CLI exécutées dans le terminal système puissent également utiliser les outils MCP de Lumina.
- **Comment utiliser :** Dans Paramètres de Lumina > Connexions (Connections), sélectionnez votre fournisseur CLI préféré, configurez le chemin du binaire et commencez à discuter dans le panneau latéral.
</details>

<details>
<summary><b>Chat Basé sur RAG & Intégrations Locales (Confidentialité Absolue)</b></summary>

- **Description :** L'IA acquiert une vision approfondie de votre base de connaissances. Elle recherche de manière autonome les notes pertinentes pendant les conversations et affiche des documents similaires et des tags recommandés dans le panneau latéral, créant des liens contextuels intelligents.
- **Sécurité Hors Ligne :** Prend en charge nativement les intégrations locales (`ibm-granite`). À moins qu'un modèle cloud ne soit sélectionné, les données précieuses de vos notes ne quitteront jamais votre appareil.
- **Entièrement Automatisé :** Aucune configuration requise ! L'indexation en arrière-plan commence silencieusement dès l'activation du plugin et se synchronise automatiquement en temps réel (mode `watch`) dès que les notes sont modifiées.
</details>

<details>
<summary><b>Découverte Intelligente (Smart Discovery)</b></summary>

- **Description :** Basé sur le moteur RAG, il visualise les informations hautement pertinentes pour la note en cours de rédaction dans l'onglet « Smart Discovery » du panneau latéral.
- **Fonctionnalités Clés :**
  - **Recherche Sémantique :** Analyse le contexte et le sens au-delà des simples mots-clés pour rechercher des notes similaires.
  - **Détection des Doublons :** Avertit si un document très similaire existe déjà dans votre coffre pour éviter la fragmentation de l'information.
  - **Tags Recommandés & Notes Liées :** Propose des tags pertinents et des notes associées en temps réel.
  - **Intégration en Un Clic :** Insérez des tags ou des liens (`[[Nom de la note]]`) en un seul clic ou lancez une conversation IA.
- **Comment utiliser :** Cliquez sur l'icône de chat sur le ruban gauche et passez à l'onglet Smart Discovery en haut.
</details>

<details>
<summary><b>Actions Rapides IA dans l'Éditeur</b></summary>

- **Description :** Transformez instantanément le texte dans l'éditeur Markdown (traduire, résumer, corriger la grammaire).
- **Comment utiliser :** Surlignez du texte et exécutez des Actions Rapides depuis le menu contextuel ou la palette de commandes.
</details>

<details>
<summary><b>Mode Agent Intelligent</b></summary>

- **Description :** Le LLM détermine et orchestre de manière autonome divers outils MCP intégrés (recherche, lecture, écriture, RAG, code en sandbox, notes quotidiennes).
- **Prise en Charge LLM Local :** Analyseur dédié pour les invites d'outils textuelles avec des modèles locaux.
- **Sécurité Robuste et Contrôle Utilisateur (Human-in-the-Loop) :** Les opérations destructives telles que la modification de contenu, la suppression de fichiers ou l'exécution de code ne peuvent pas être traitées par l'agent seul. Les modifications de fichiers nécessitent un **examen Diff en ligne** dans l'éditeur avec acceptation/rejet par bloc, tandis que les actions sensibles comme la création, la suppression de fichiers ou l'exécution de code nécessitent une approbation explicite via des **cartes d'approbation en ligne** dans le panneau de discussion. (Sauvegardes automatiques avec protection contre l'écrasement incluses)
- **Limites d'Utilisation :** Limites par défaut pour éviter les boucles infinies.
- **Comment utiliser :** Tapez `/mcp` dans le chat ou activez le Mode Agent depuis l'icône en haut.
</details>

<details>
<summary><b>Intégration MCP (Support client & serveur bidirectionnel)</b></summary>

- **Description :** Relie de manière transparente Obsidian au vaste écosystème de l'IA via le Model Context Protocol (MCP). Utilisez Obsidian comme un hub IA tout-en-un, ou tirez-en parti comme le second cerveau de votre IA !
- **Mode Client (Dirigé par Obsidian) :**
  - Interagissez et travaillez directement avec l'IA au sein d'Obsidian.
  - Connectez de nombreux serveurs MCP externes (GitHub, bases de données locales, recherche web, etc.) pour extraire et organiser instantanément de vastes quantités de données dans vos notes.
- **Mode Serveur (Dirigé par une IA Externe) :**
  - Fournit divers outils permettant à des assistants IA externes (Claude, Cursor, etc.) ou à l'IA en Mode Agent d'accéder directement à votre coffre-fort.
  - **Recherche Web:** `lumina_web_search` (Recherche d'informations sur Internet en temps réel à l'aide de divers moteurs de recherche tels que Tavily, Exa, Google, avec prise en charge de la troncature intelligente)
  - **Lecture & Recherche :** `read_active_note`, `read_note` (prend en charge les plages de lignes `startLine`/`endLine`), `search_notes` (prend en charge le filtrage par tags), `grep_search` (recherche de lignes par texte/regex dans tout le coffre), `glob_files` (correspondance de chemins avec jokers, ex: `**/*.md`), `list_notes`, `rag_search`, `get_backlinks`, `get_note_metadata`, `list_attachments`, `list_tags`, `query_metadata` pour fournir un contexte étendu à l'IA.
  - **Écriture & Modification :** `create_note`, `append_to_note`, `replace_note`, `patch_note`, `update_frontmatter`, `save_attachment`, `create_canvas`, `generate_moc`, `auto_link_note` (créer/modifier des notes/canevas (canvas), générer des notes MOC (Map of Content) et sauvegarder des fichiers binaires).
  - **Gestion & Exécution :** `open_note` (ouvrir instantanément une note/fichier dans un onglet d'éditeur), `delete_note`, `move_note` (déplacer/renommer), `execute_code`, `run_note_code_block` (exécuter du code dans un bac à sable), `run_shell_command` (exécuter des commandes shell de terminal sur le système d'exploitation de bureau), `show_notice` (afficher des notifications Obsidian).
  - **Notes Quotidiennes :** `read_daily_note`, `append_to_daily_note` (lecture/écriture pour la note quotidienne d'aujourd'hui).
  - **Synchronisation MCP pour CLI en Terminal Externe :** Synchronise facultativement les fichiers de configuration (`.claude/mcp.json`, `opencode.json`, `codex.json`) pour que les outils de coffre de Lumina soient accessibles depuis un terminal externe.
  - **Sécurité du Coffre et Contrôle Utilisateur (Human-in-the-Loop) :** Cartes d'approbation en ligne pour les actions sensibles, examen Diff en ligne dans l'éditeur lors de la modification de fichiers, sauvegardes automatiques avec protection contre l'écrasement et exécution de code isolée en bac à sable.
- **Comment utiliser :** Activez les fonctionnalités MCP dans les paramètres du plugin et configurez la méthode de transport client/serveur (SSE).
- **Remarque :** *Lumina intègre des mécanismes de sécurité multicouches, notamment l'exécution de code en bac à sable, l'examen Diff en ligne et l'approbation de l'utilisateur (Human-in-the-Loop), des sauvegardes automatiques lors des modifications de fichiers (protection contre l'écrasement) et des limites pour éviter les boucles infinies ou les appels d'outils incontrôlés. Cependant, comme l'agent et les IA externes accèdent directement à votre coffre, nous vous recommandons de surveiller de près les opérations au début.*
</details>

---

## Mode Débogage & Rapports de Bugs

Vous pouvez afficher toutes les données internes traitées par le plugin en activant les Paramètres Avancés et en cochant le [Mode Débogage] sous l'onglet [Divers et Extensions] dans les paramètres. (Les journaux de débogage ne sont sauvegardés qu'une fois téléchargés).

**Informations Utiles pour la Résolution :**
- Votre système d'exploitation (Windows, macOS, Linux) et la version d'Obsidian.
- Le Fournisseur d'IA et le Nom du Modèle utilisé (ex. : OpenAI / gpt-4o, Ollama / llama3).
- Le fichier journal téléchargé après l'apparition de l'erreur en Mode Débogage.
> [!IMPORTANT]
> Les fichiers journaux pouvant contenir des transcriptions de chat, veuillez supprimer toute information sensible avant de soumettre.
> **[Signaler un Bug (GitHub Issues)](https://github.com/lumina-apps/obsidian-lumina/issues)**

---

## Soutien & Sponsoring

Ce plugin est distribué 100% gratuitement et sera continuellement mis à jour.
 
**[Ko-fi](https://ko-fi.com/luminaapps)**  
**[Ctee](https://ctee.kr/place/luminaapps)**