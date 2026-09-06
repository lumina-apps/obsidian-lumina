# Lumina: Asistente de IA Todo en Uno (RAG + MCP + Agentes CLI)

**`Lumina` es un potente plugin asistente todo en uno para Obsidian que transforma tu base de conocimientos en un centro completo de IA al combinar soporte multi-LLM (en la nube y local), agentes CLI de terminal (Claude Code, Antigravity, OpenCode, Codex), RAG sin configuración, integración bidireccional MCP y agentes de IA autónomos.**

<p align="center">
  <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/README.md">English</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_KO.md">한국어</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_JA.md">日本語</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ZH.md">简体中文</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ZH_TW.md">繁體中文</a> | <b>Español</b> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_DE.md">Deutsch</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_FR.md">Français</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_PT.md">Português</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_RU.md">Русский</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_IT.md">Italiano</a>
</p>

> **¡Optimizado para Entornos Multilingües!** Los modelos de incrustación (embeddings) integrados y la interfaz de usuario están completamente localizados para entornos multilingües. (¡Los comentarios sobre la traducción siempre son bienvenidos!)

![alt text](readme.gif)

---

## Características Principales

| Característica | Descripción |
| :--- | :--- |
| **Vista de Chat Multi-LLM** | Un panel lateral dedicado que entiende el contexto de tus notas. Soporta desde potentes modelos en la nube hasta LLMs locales para máxima privacidad. |
| **Integración de Agentes CLI de Terminal** | Ejecuta agentes de IA de terminal oficiales (Claude Code, Antigravity, OpenCode, Codex) en el panel lateral de Obsidian para explorar y organizar tus notas con flujo de pensamiento en tiempo real y modos de seguridad. |
| **RAG Sin Configuración** | Cuenta con incrustaciones locales 100% offline para evitar filtraciones de datos. Indexa automáticamente tu bóveda en tiempo real sin configuraciones complejas. |
| **Descubrimiento Inteligente (Smart Discovery)** | Encuentra instantáneamente documentos altamente relevantes para la nota actual usando búsqueda semántica, detecta y advierte sobre posibles duplicados, e inserta etiquetas recomendadas y enlaces relacionados con un solo clic. |
| **Acciones Rápidas de IA en Línea** | Resalta texto en el editor para resumir, traducir o corregir instantáneamente sin interrumpir tu flujo de escritura. |
| **Modo de Agente Inteligente** | El LLM planifica y ejecuta tareas complejas como búsqueda, creación, modificación, eliminación/movimiento de notas y ejecución de código en un sandbox usando varias herramientas MCP integradas. |
| **Integración MCP (Cliente y Servidor)** | Integración bidireccional y completa que permite usar herramientas externas dentro de Obsidian (Cliente) o dejar que las IA externas interactúen con tus notas (Servidor). |

---

## Inicio Rápido

Lumina ofrece dos modos según tu nivel de experiencia. ¡Elige el que más te guste!

### Pista 1: Comienza en 3 Pasos (Recomendado para Principiantes)
1. Instala y habilita Lumina.
2. Ve a Configuración > Lumina e ingresa tu **clave API gratuita (Gemini o Groq)** obtenida de los enlaces a continuación.
   - [Obtener Clave de API de Google Gemini (Gratis)](https://aistudio.google.com/app/apikey)
   - [Obtener Clave de API de Groq (Gratis)](https://console.groq.com/keys)
3. Abre cualquier nota y hazle una pregunta a Lumina en el panel lateral derecho. ¡Eso es todo! (Una vez que la indexación del RAG local se complete en el panel lateral, las conversaciones basadas en tus notas se activarán inmediatamente.)

### Pista 2: Domina el Agente (Recomendado para Usuarios Avanzados)
1. Conecta un LLM local o tu IA en la nube preferida en la configuración.
2. Escribe `/mcp` en el chat para activar el **Modo Agente Inteligente**.
3. Emite comandos autónomos como: "Encuentra todas las notas de reuniones de esta semana en mi bóveda y compílalas en un solo archivo de resumen."

> [!IMPORTANT]
> **Almacenamiento Seguro de Claves API**
> Todas las claves de API que ingreses nunca se almacenan como archivos de texto sin formato. Están encriptadas de forma segura y se almacenan localmente a través de `SecretStorage` integrado en Obsidian, lo que garantiza que tus datos permanezcan seguros.

---

## Características Detalladas y Uso (Haz Clic para Expandir)
<details>
<summary><b>Vista de Chat Multi-LLM (Soporte Local y en la Nube)</b></summary>

- **Descripción:** Conversa instantáneamente con varios modelos de IA a través de un panel lateral dedicado dentro de Obsidian. Soporta totalmente potentes modelos en la nube como Gemini y Groq, así como **LLMs Locales** (Ollama, LM Studio, etc.) para privacidad absoluta.
- **Cómo usar:** Haz clic en el icono de chat en la cinta izquierda o ejecuta `Lumina: Open Chat` desde la paleta de comandos.
- **Consejo Pro:** Resalta texto en el editor, haz clic derecho y usa el menú contextual para inyectar directamente el texto seleccionado en el chat como contexto para tus preguntas.
</details>

<details>
<summary><b>Integración de Agentes CLI de Terminal (Claude Code, Antigravity, OpenCode, Codex)</b></summary>

- **Descripción:** Ejecuta y orquesta agentes de IA de terminal directamente en el panel lateral de Obsidian para explorar, analizar y organizar las notas de tu bóveda.
- **Agentes Compatibles:** Anthropic **Claude Code**, Google **Antigravity**, **OpenCode**, OpenAI **Codex**.
- **Características Clave:**
  - **Selector de Seguridad Solo Lectura / Edición:** Alterna con un solo clic en la barra de herramientas del chat entre el modo 👁️ **Solo Lectura** (inspecciona y analiza notas de forma segura sin modificar archivos) y el modo ✏️ **Edición**.
  - **Pensamiento Visual:** Transmite y muestra el proceso de razonamiento interno del agente en bloques plegables de pensamiento en tiempo real.
  - **Estado en Tiempo Real y Archivos Modificados:** Muestra el estado de ejecución de las herramientas en tiempo real y proporciona insignias con enlaces para abrir al instante los archivos modificados por el agente.
  - **Contexto Automático de Nota Activa y Archivos:** Envía automáticamente la nota activa y las imágenes/archivos adjuntos al prompt del CLI para conversaciones contextuales sin interrupciones.
  - **Sincronización MCP para Terminal Externa (Opcional):** Genera archivos de configuración (`.claude/mcp.json`, `opencode.json`, `codex.json`) en tu bóveda para que las sesiones de CLI en la terminal del sistema también puedan usar las herramientas MCP de Lumina.
- **Cómo usar:** En Configuración de Lumina > Conexiones (Connections), selecciona tu proveedor de CLI preferido, configura la ruta del binario y comienza a conversar en el panel lateral.
</details>

<details>
<summary><b>Chat Basado en RAG e Incrustaciones Locales (Privacidad Absoluta)</b></summary>

- **Descripción:** La IA obtiene una visión profunda de tu base de conocimientos. Busca notas relevantes de forma autónoma durante las conversaciones y muestra documentos similares y etiquetas recomendadas en el panel lateral, creando enlaces contextuales inteligentes.
- **Seguridad Fuera de Línea:** El sistema RAG de Lumina utiliza incrustaciones locales 100% fuera de línea (modelo de incrustación multilingüe integrado `ibm-granite`) para analizar sus notas. A menos que se seleccione un modelo en la nube, sus valiosos datos de notas nunca saldrán de su dispositivo.
- **Totalmente Automatizado:** ¡No se requiere configuración! La indexación en segundo plano comienza en el momento en que se habilita el plugin y se sincroniza automáticamente en tiempo real (modo `watch`) cada vez que se modifican las notas.
</details>

<details>
<summary><b>Descubrimiento Inteligente (Smart Discovery)</b></summary>

- **Descripción:** Basado en el motor RAG, visualiza información altamente relevante para la nota actual directamente en la pestaña "Smart Discovery" del panel lateral.
- **Características Clave:**
  - **Búsqueda Semántica:** Analiza el contexto y significado para buscar notas similares más allá de palabras clave.
  - **Detección de Documentos Duplicados:** Muestra una advertencia si ya existe un documento muy similar en tu bóveda.
  - **Etiquetas Recomendadas y Notas Relacionadas:** Sugiere etiquetas adecuadas y notas relacionadas en tiempo real.
  - **Integración con un Clic:** Inserta etiquetas o enlaces (`[[Nombre de Nota]]`) con un solo clic o inicia una conversación con IA.
- **Cómo usar:** Haz clic en el icono de chat en la cinta izquierda y cambia a la pestaña Smart Discovery.
</details>

<details>
<summary><b>Acciones Rápidas de IA en el Editor</b></summary>

- **Descripción:** Transforma texto al instante dentro del editor Markdown (traducir, resumir, corregir gramática).
- **Cómo usar:** Resalta texto y ejecuta Acciones Rápidas desde el menú emergente o paleta de comandos.
</details>

<details>
<summary><b>Modo de Agente Inteligente</b></summary>

- **Descripción:** El LLM determina y coordina de forma autónoma varias herramientas MCP integradas (buscar, leer, escribir, RAG, código sandbox, notas diarias).
- **Soporte para LLM Local:** Parser dedicado para prompts basados en texto para modelos locales.
- **Seguridad Robusta y Control del Usuario (Human-in-the-Loop):** Las operaciones destructivas como la modificación de contenido, eliminación de archivos o ejecución de código no pueden ser procesadas por el agente por sí solo. Las modificaciones de archivos requieren una **revisión Diff en línea** en el editor con aceptación/rechazo fragmento por fragmento, mientras que acciones sensibles como la creación, eliminación de archivos o ejecución de código requieren aprobación explícita mediante **tarjetas de aprobación en línea** en el panel de chat. (Copias de seguridad automáticas de protección contra sobreescritura incluidas)
- **Límites de Uso:** Límites predeterminados para evitar bucles infinitos.
- **Cómo usar:** Escribe `/mcp` en el chat o activa el Modo Agente desde el icono superior.
</details>

<details>
<summary><b>Integración MCP (Soporte Bidireccional Cliente y Servidor)</b></summary>

- **Descripción:** Conecta perfectamente Obsidian con el ecosistema de IA más amplio a través del Protocolo de Contexto de Modelos (MCP). ¡Utiliza Obsidian como un centro de IA todo en uno, o aprovéchalo como el segundo cerebro de tu IA!
- **Modo Cliente (Dirigido por Obsidian):**
  - Interactúa y trabaja directamente con IA dentro de Obsidian.
  - Conecta numerosos servidores MCP externos (GitHub, bases de datos locales, búsqueda web, etc.) para extraer (scrape) y organizar instantáneamente grandes cantidades de datos en tus notas.
- **Modo Servidor (Dirigido por IA Externa):**
  - Proporciona varias herramientas que permiten a asistentes de IA externos (Claude, Cursor, etc.) o a la IA en Modo Agente acceder directamente a tu bóveda.
  - **Búsqueda Web:** `lumina_web_search` (Búsqueda de información en Internet en tiempo real utilizando varios motores de búsqueda como Tavily, Exa, Google, con soporte de truncamiento inteligente)
  - **Lectura y Búsqueda:** `read_active_note`, `read_note` (admite rangos de líneas `startLine`/`endLine`), `search_notes` (admite filtrado de etiquetas), `grep_search` (búsqueda de líneas por texto/regex en toda la bóveda), `glob_files` (coincidencia de rutas de archivo con comodines, ej. `**/*.md`), `list_notes`, `rag_search`, `get_backlinks`, `get_note_metadata`, `list_attachments`, `list_tags`, `query_metadata` para proporcionar un contexto amplio a la IA.
  - **Escritura y Modificación:** `create_note`, `append_to_note`, `replace_note`, `patch_note`, `update_frontmatter`, `save_attachment`, `create_canvas`, `generate_moc`, `auto_link_note` (crear/modificar notas/lienzos, generar notas MOC y guardar archivos binarios).
  - **Gestión y Ejecución:** `open_note` (abrir nota/archivo al instante en pestaña del editor), `delete_note`, `move_note` (mover/renombrar), `execute_code`, `run_note_code_block` (ejecutar código en sandbox), `run_shell_command` (ejecutar comandos shell de terminal en el SO de escritorio), `show_notice` (mostrar notificaciones de Obsidian).
  - **Notas Diarias:** `read_daily_note`, `append_to_daily_note` (lectura/escritura para la nota diaria de hoy).
  - **Sincronización MCP para CLI de Terminal Externa:** Sincroniza opcionalmente archivos de configuración (`.claude/mcp.json`, `opencode.json`, `codex.json`) para que las herramientas de la bóveda de Lumina estén disponibles desde la terminal externa.
  - **Seguridad de la Bóveda y Control del Usuario (Human-in-the-Loop):** Tarjetas de aprobación en línea para operaciones sensibles, revisión Diff en línea en el editor para modificación de archivos, copias de seguridad automáticas de protección contra sobreescritura y ejecución de código aislada en sandbox.
- **Cómo usar:** Habilita las características MCP en la configuración del plugin y configura el método de transporte cliente/servidor (SSE).
- **Nota:** *Lumina cuenta con mecanismos de seguridad de múltiples capas, que incluyen la ejecución de código en sandbox, revisión Diff en línea y aprobación del usuario (Human-in-the-Loop), copias de seguridad automáticas durante las modificaciones de archivos (protección contra sobreescritura) y límites para evitar llamadas descontroladas a herramientas o bucles infinitos. Sin embargo, dado que el agente y la IA externa acceden directamente a tu bóveda, recomendamos inicialmente monitorear las operaciones de cerca.*
</details>

---

## Modo de Depuración e Informes de Errores

Puedes ver todos los datos internos procesados por el plugin habilitando la Configuración Avanzada y activando el [Modo de Depuración] bajo la pestaña [Varios y extensiones] en la configuración. (Los registros de depuración no se guardan hasta que se descargan).

**Información Útil para la Resolución:**
- Tu sistema operativo (Windows, macOS, Linux) y la versión de Obsidian.
- El Proveedor de IA y Nombre del Modelo utilizado (ej., OpenAI / gpt-4o, Ollama / llama3).
- El archivo de registro descargado después de que ocurrió el error en Modo de Depuración.
> [!IMPORTANT]
> Dado que los archivos de registro pueden contener transcripciones de chat, elimina cualquier información confidencial antes de enviar.
> **[Reportar un Error (GitHub Issues)](https://github.com/lumina-apps/obsidian-lumina/issues)**

---

## Apoyo y Patrocinio

Este plugin se distribuye 100% de forma gratuita y se actualizará continuamente.

**[Ko-fi](https://ko-fi.com/luminaapps)**  
**[Ctee](https://ctee.kr/place/luminaapps)**