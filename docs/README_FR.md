# 🚀 Lumina : Assistant IA Tout-en-Un (RAG + MCP + Agent)

**`Lumina` est un puissant plugin assistant tout-en-un pour Obsidian qui transforme votre base de connaissances en un véritable hub IA, combinant la prise en charge multi-LLM, un RAG sans configuration, une intégration MCP bidirectionnelle et des agents IA autonomes.**

<p align="center">
  <a href="/README.md">English</a> | <a href="/docs/README_KO.md">한국어</a> | <a href="/docs/README_JA.md">日本語</a> | <a href="/docs/README_ZH.md">简体中文</a> | <a href="/docs/README_ZH_TW.md">繁體中文</a> | <a href="/docs/README_ES.md">Español</a> | <a href="/docs/README_DE.md">Deutsch</a> | <b>Français</b> | <a href="/docs/README_PT.md">Português</a> | <a href="/docs/README_RU.md">Русский</a> | <a href="/docs/README_IT.md">Italiano</a>
</p>

> 🌐 **Optimisé pour les Environnements Multilingues !** Les modèles d'intégration (embeddings) intégrés et l'interface utilisateur sont entièrement localisés pour les environnements multilingues. (Les retours sur la traduction sont toujours les bienvenus !)

![alt text](readme.gif)

---

## 🌟 Fonctionnalités Principales

| Fonctionnalité | Description |
| :--- | :--- |
| **💬 Vue de Chat Multi-LLM** | Un panneau latéral dédié qui comprend le contexte de vos notes. Prend en charge des modèles cloud puissants jusqu'aux LLM locaux pour un maximum de confidentialité. |
| **🧠 RAG Sans Configuration** | Propose des intégrations locales (embeddings) 100% hors ligne pour éviter les fuites de données. Indexe automatiquement votre coffre-fort en temps réel sans configurations complexes. |
| **⚡ Actions Rapides IA en Ligne** | Surlignez du texte dans l'éditeur pour résumer, traduire ou corriger instantanément, sans interrompre votre flux de rédaction. |
| **🤖 Agent IA Autonome** | Les LLM planifient et exécutent de manière autonome des tâches complexes telles que la recherche, la création et la modification de notes à l'aide d'outils MCP. (Expérimental) |
| **🔌 Intégration MCP (Client & Serveur)** | Une intégration bidirectionnelle complète qui vous permet d'utiliser des outils externes au sein d'Obsidian (Client), ou de laisser des IA externes interagir avec vos notes (Serveur). (Expérimental) |

---

## ⚡ Démarrage Rapide

1. **Installez** et activez `Lumina` depuis les Plugins Communautaires d'Obsidian.
2. Une fois activé, le modèle RAG intégré commencera automatiquement à analyser vos notes en arrière-plan. (La navigation intelligente devient disponible dans le panneau latéral).
3. **[Activer le Chat IA]** Accédez aux Paramètres d'Obsidian ➔ `Lumina`.
4. Ajoutez votre fournisseur LLM préféré et entrez vos clés API.
   - 💻 **Les LLM Locaux (Ollama, LM Studio, etc.)** peuvent être connectés instantanément sans clé API !
   - ☁️ **Les LLM Cloud** nécessitent des clés API, qui peuvent facilement être obtenues gratuitement :
     - 👉 [Obtenir une Clé API Google Gemini (Gratuit)](https://aistudio.google.com/app/apikey)
     - 👉 [Obtenir une Clé API Groq (Gratuit)](https://console.groq.com/keys)
5. **[Ouvrir le Chat & Utilisation de Base]** Cliquez sur l'icône 💬 dans le menu ruban de gauche pour ouvrir la Vue de Chat et commencer à interagir avec l'IA, ou surlignez du texte dans l'éditeur et faites un clic droit pour déclencher les Actions Rapides.
6. **[Activer le Mode Agent]** Tapez la commande `/mcp` dans le chat ou ouvrez le menu contextuel rapide pour activer le **🤖 Mode Agent**.
   - *Astuce : Le serveur interne Lumina requis pour les opérations autonomes de l'agent démarrera automatiquement en arrière-plan.*
7. **Attribuer des Tâches Autonomes :** Avec le Mode Agent actif, donnez des instructions complexes telles que : "Trouve toutes les notes liées à 'l'Intelligence Artificielle' dans mon coffre, résume les points clés et organise-les dans une nouvelle note." L'IA déterminera et exécutera de manière autonome les outils nécessaires pour accomplir la tâche.

> [!IMPORTANT]
> **🔒 Stockage Sécurisé des Clés API**
> Toutes les clés API que vous entrez ne sont jamais stockées sous forme de fichiers texte en clair. Elles sont cryptées de manière sécurisée et stockées localement via le `SecretStorage` intégré d'Obsidian, garantissant ainsi la sécurité de vos données.

---

## ✨ Fonctionnalités Détaillées & Utilisation (Cliquez pour Développer)

<details>
<summary><b>💬 Vue de Chat Multi-LLM (Prise en charge Cloud & Locale)</b></summary>

- **Description :** Discutez instantanément avec divers modèles d'IA via un panneau latéral dédié à l'intérieur d'Obsidian. Prend entièrement en charge des modèles cloud puissants comme Gemini et Groq, ainsi que des **LLM Locaux** (Ollama, LM Studio, etc.) pour une confidentialité absolue.
- **Comment utiliser :** Cliquez sur l'icône 💬 sur le ruban gauche ou exécutez `Lumina: Open Chat` depuis la palette de commandes.
- **💡 Astuce Pro :** Surlignez du texte dans l'éditeur, faites un clic droit, et utilisez le menu contextuel pour injecter directement le texte sélectionné dans le chat comme contexte pour vos questions !
</details>

<details>
<summary><b>🧠 Chat Basé sur RAG & Intégrations Locales (Confidentialité Absolue)</b></summary>

- **Description :** L'IA obtient une vision approfondie de votre base de connaissances. Elle recherche de manière autonome les notes pertinentes pendant les conversations et affiche les documents similaires ainsi que les balises recommandées dans le panneau latéral, créant des liens contextuels intelligents.
- **Sécurité Hors Ligne :** Prend en charge nativement les intégrations (embeddings) locales (`ibm-granite`). À moins qu'un modèle cloud ne soit sélectionné, vos précieuses données de notes ne quitteront jamais votre appareil.
- **Entièrement Automatisé :** Aucune configuration requise ! L'indexation en arrière-plan démarre discrètement dès que le plugin est activé, et se synchronise automatiquement en temps réel (mode `watch`) chaque fois que les notes sont modifiées.
</details>

<details>
<summary><b>⚡ IA Éditeur en Ligne (Actions Rapides)</b></summary>

- **Description :** Transformez instantanément du texte dans l'éditeur markdown sans interrompre votre flux de rédaction. Gérez facilement la traduction, la synthèse, la correction grammaticale et les explications détaillées pour le texte sélectionné.
- **Comment utiliser :** Surlignez le texte et exécutez les Actions Rapides via le menu contextuel en ligne ou la palette de commandes. *(💡 Astuce : Attribuez des raccourcis clavier dans les paramètres d'Obsidian pour un accès ultra-rapide !)*
</details>

<details>
<summary><b>🤖 Agent IA Autonome (Mode Agent) ⚠️</b></summary>

- **Description :** Lorsqu'il est activé, le LLM détermine et orchestre de manière autonome les outils MCP pour effectuer des tâches. Il peut réaliser des opérations complexes à plusieurs étapes en combinant la recherche, la lecture, l'écriture de notes et la récupération RAG.
- **Prise en charge LLM Local :** Implémente un analyseur dédié qui prend en charge le "tool prompting" basé sur le texte, permettant à l'agent de fonctionner sans problème même dans des environnements LLM Locaux, et pas seulement avec des modèles cloud hautes performances.
- **Mécanismes de Sécurité :** Pour éviter les boucles infinies ou les coûts d'API excessifs, une limite maximale d'étapes d'exécution par requête (par défaut : 15 étapes) est imposée. L'exécution s'interrompt automatiquement si des appels répétés aux outils sont détectés.
- **Comment utiliser :** Tapez la commande `/mcp` dans le chat ou utilisez l'icône supérieure pour ouvrir la fenêtre contextuelle rapide et activer le 'Mode Agent'. (Le serveur interne Lumina démarrera automatiquement selon les besoins pour exécuter les outils.)
</details>

<details>
<summary><b>🤖 Intégration MCP (Prise en charge Bidirectionnelle Client & Serveur) ⚠️</b></summary>

- **Description :** Relie de manière transparente Obsidian au vaste écosystème de l'IA via le Model Context Protocol (MCP). Utilisez Obsidian comme un hub IA tout-en-un, ou tirez-en parti comme le second cerveau de votre IA !
- **💻 Mode Client (Dirigido par Obsidian) :**
  - Interagissez et travaillez directement avec l'IA au sein d'Obsidian.
  - Connectez de nombreux serveurs MCP externes (GitHub, bases de données locales, recherche web, etc.) pour extraire et organiser instantanément de vastes quantités de données dans vos notes.
- **🖥️ Mode Serveur (Dirigido par une IA Externe) :**
  - Expose 7 outils permettant à des assistants IA externes (Claude, Cursor, etc.) d'accéder directement à votre coffre-fort.
  - `read_active_note`, `read_note`, `search_notes`, `rag_search` : Fournit le contexte et les connaissances de votre coffre-fort à l'IA.
  - `create_note`, `append_to_note` : Permet à l'IA d'écrire en toute sécurité des idées organisées directement dans votre coffre-fort (protection d'écrasement appliquée).
  - `read_daily_note`, `append_to_daily_note` : Intégration de lecture/écriture pour la note quotidienne d'aujourd'hui.
- **Comment utiliser :** Activez les fonctionnalités MCP dans les paramètres du plugin et configurez la méthode de transport client/serveur (SSE).
- **Remarque :** *Les fonctionnalités d'Agent et de MCP sont actuellement en phase Expérimentale (Bêta). Bien que divers filets de sécurité comme la protection contre l'écrasement et des limites de caractères soient en place, nous recommandons de surveiller étroitement les opérations au début, car des IA externes éditeront directement vos notes.*
</details>

---

## 🐛 Mode Débogage & Rapports de Bugs

Vous pouvez afficher toutes les données internes traitées par le plugin en activant les Paramètres Avancés et en cochant le [Mode Débogage] sous l'onglet [Add-ons & Divers] dans les paramètres. (Les journaux de débogage ne sont sauvegardés qu'une fois téléchargés).

**💡 Informations Utiles pour la Résolution :**
- Votre système d'exploitation (Windows, macOS, Linux) et la version d'Obsidian.
- Le Fournisseur d'IA et le Nom du Modèle utilisé (ex. : OpenAI / gpt-4o, Ollama / llama3).
- Le fichier journal téléchargé après l'apparition de l'erreur en Mode Débogage.
> [!IMPORTANT]
> Les fichiers journaux pouvant contenir des transcriptions de chat, veuillez supprimer toute information sensible avant de soumettre.
> **[Signaler un Bug (GitHub Issues)](https://github.com/lumina-apps/obsidian-lumina/issues)**

---

## ☕ Soutien & Sponsoring

Ce plugin est distribué 100% gratuitement et sera continuellement mis à jour.
Le sponsoring me motive à publier des mises à jour encore plus rapidement !

👉 **[GitHub Sponsor](https://github.com/sponsors/lumina-apps)**  
👉 **[Ko-fi](https://ko-fi.com/luminaapps)**  
👉 **[Ctee](https://ctee.kr/place/luminaapps)**
