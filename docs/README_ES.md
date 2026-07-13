# 🚀 Lumina: Asistente de IA Todo en Uno (RAG + MCP + Agent)

**`Lumina` es un potente plugin asistente todo en uno para Obsidian que transforma tu base de conocimientos en un centro completo de IA al combinar soporte multi-LLM, RAG sin configuración, integración bidireccional MCP y agentes de IA autónomos.**

<p align="center">
  <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/README.md">English</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_KO.md">한국어</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_JA.md">日本語</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ZH.md">简体中文</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ZH_TW.md">繁體中文</a> | <b>Español</b> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_DE.md">Deutsch</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_FR.md">Français</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_PT.md">Português</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_RU.md">Русский</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_IT.md">Italiano</a>
</p>

> 🌐 **¡Optimizado para Entornos Multilingües!** Los modelos de incrustación (embeddings) integrados y la interfaz de usuario están completamente localizados para entornos multilingües. (¡Los comentarios sobre la traducción siempre son bienvenidos!)

![alt text](readme.gif)

---

## 🌟 Características Principales

| Característica | Descripción |
| :--- | :--- |
| **💬 Vista de Chat Multi-LLM** | Un panel lateral dedicado que entiende el contexto de tus notas. Soporta desde potentes modelos en la nube hasta LLMs locales para máxima privacidad. |
| **🧠 RAG Sin Configuración** | Cuenta con incrustaciones locales 100% offline para evitar filtraciones de datos. Indexa automáticamente tu bóveda en tiempo real sin configuraciones complejas. |
| **🔗 Descubrimiento Inteligente (Smart Discovery)** | Encuentra instantáneamente documentos altamente relevantes para la nota actual usando búsqueda semántica, detecta y advierte sobre posibles duplicados, e inserta etiquetas recomendadas y enlaces relacionados con un solo clic. |
| **⚡ Acciones Rápidas de IA en Línea** | Resalta texto en el editor para resumir, traducir o corregir instantáneamente sin interrumpir tu flujo de escritura. |
| **🚀 Modo de Agente Inteligente** | El LLM planifica y ejecuta tareas complejas como búsqueda, creación, modificación, eliminación/movimiento de notas y ejecución de código en un sandbox usando varias herramientas MCP integradas. |
| **🔌 Integración MCP (Cliente y Servidor)** | Integración bidireccional y completa que permite usar herramientas externas dentro de Obsidian (Cliente) o dejar que las IA externas interactúen con tus notas (Servidor). |

---

## ⚡ Inicio Rápido

Lumina ofrece dos modos según tu nivel de experiencia. ¡Elige el que más te guste!

### 🟢 Pista 1: Comienza en 3 Pasos (Recomendado para Principiantes)
1. Instala y habilita Lumina.
2. Ve a Configuración > Lumina e ingresa tu **clave API gratuita (Gemini o Groq)** obtenida de los enlaces a continuación.
   - 👉 [Obtener Clave de API de Google Gemini (Gratis)](https://aistudio.google.com/app/apikey)
   - 👉 [Obtener Clave de API de Groq (Gratis)](https://console.groq.com/keys)
3. Abre cualquier nota y hazle una pregunta a Lumina en el panel lateral derecho. ¡Eso es todo! (Una vez que la indexación del RAG local se complete en el panel lateral, las conversaciones basadas en tus notas se activarán inmediatamente.)

### 🔵 Pista 2: Domina el Agente (Recomendado para Usuarios Avanzados)
1. Conecta un LLM local o tu IA en la nube preferida en la configuración.
2. Escribe `/mcp` en el chat para activar el **Modo Agente Inteligente**.
3. Emite comandos autónomos como: "Encuentra todas las notas de reuniones de esta semana en mi bóveda y compílalas en un solo archivo de resumen."

> [!IMPORTANT]
> **🔒 Almacenamiento Seguro de Claves API**
> Todas las claves de API que ingreses nunca se almacenan como archivos de texto sin formato. Están encriptadas de forma segura y se almacenan localmente a través de `SecretStorage` integrado en Obsidian, lo que garantiza que tus datos permanezcan seguros.

---

## ✨ Características Detalladas y Uso (Haz Clic para Expandir)
<details>
<summary><b>💬 Vista de Chat Multi-LLM (Soporte Local y en la Nube)</b></summary>

- **Descripción:** Conversa instantáneamente con varios modelos de IA a través de un panel lateral dedicado dentro de Obsidian. Soporta totalmente potentes modelos en la nube como Gemini y Groq, así como **LLMs Locales** (Ollama, LM Studio, etc.) para privacidad absoluta.
- **Cómo usar:** Haz clic en el icono 💬 en la cinta izquierda o ejecuta `Lumina: Open Chat` desde la paleta de comandos.
- **💡 Consejo Pro:** Resalta texto en el editor, haz clic derecho y usa el menú contextual para inyectar directamente el texto seleccionado en el chat como contexto para tus preguntas.
</details>

<details>
<summary><b>🧠 Chat Basado en RAG e Incrustaciones Locales (Privacidad Absoluta)</b></summary>

- **Descripción:** La IA obtiene una visión profunda de tu base de conocimientos. Busca de manera autónoma notas relevantes durante las conversaciones y muestra documentos similares y etiquetas recomendadas en el panel lateral, creando enlaces contextuales inteligentes.
- **Seguridad Offline:** Soporta de forma nativa incrustaciones (embeddings) locales (`ibm-granite`). A menos que se seleccione un modelo en la nube, los valiosos datos de tus notas nunca saldrán de tu dispositivo.
- **Totalmente Automatizado:** ¡No requiere configuración! La indexación en segundo plano comienza silenciosamente en el momento en que se habilita el plugin, y se sincroniza automáticamente en tiempo real (modo `watch`) cada vez que se modifican las notas.
</details>

<details>
<summary><b>🔗 Descubrimiento Inteligente (Smart Discovery)</b></summary>

- **Descripción:** Basado en el motor RAG, visualiza información altamente relevante para la nota actual en la pestaña de "Descubrimiento Inteligente" en el panel lateral.
- **Características principales:**
  - **Búsqueda semántica:** Más allá de la simple coincidencia de palabras clave, analiza el contexto y el significado de la frase para buscar notas similares.
  - **Detección de duplicados:** Muestra una advertencia si ya existe un documento muy similar en su vault para evitar la fragmentación y la duplicación de información.
  - **Etiquetas recomendadas y notas relacionadas:** Analiza el contexto de la nota actual para recomendar etiquetas apropiadas y sugerir notas relacionadas en tiempo real.
  - **Integración y chat con un clic:** Inserte etiquetas recomendadas o notas relacionadas en su documento como etiquetas o enlaces markdown (`[[Nombre de Nota]]`) con un solo clic, o prepare las notas seleccionadas en el área de preparación para iniciar un chat de IA de inmediato.
- **Cómo usar:** Haga clic en el icono 💬 de la cinta izquierda para abrir el panel lateral y cambie a la pestaña 🔗 (Descubrimiento Inteligente) en la parte superior.
</details>

<details>
<summary><b>⚡ IA Integrada en el Editor (Acciones Rápidas)</b></summary>

- **Descripción:** Transforma texto instantáneamente dentro del editor de markdown sin interrumpir tu flujo de escritura. Maneja fácilmente traducciones, resúmenes, correcciones gramaticales y explicaciones detalladas para el texto seleccionado.
- **Cómo usar:** Resalta el texto y ejecuta Acciones Rápidas a través del menú emergente en línea o la paleta de comandos. *(💡 Consejo: ¡Asigna teclas de acceso rápido en la configuración de Obsidian para un acceso rapidísimo!)*
</details>

<details>
<summary><b>🚀 Modo de Agente Inteligente</b></summary>

- **Descripción:** Cuando se activa, el LLM determina y organiza de forma autónoma varias herramientas MCP integradas para realizar tareas. Puede completar operaciones complejas de varios pasos combinando la búsqueda, lectura y escritura de notas, recuperación RAG, ejecución de código en sandbox e integración de notas diarias.
- **Soporte para LLM local:** Implementa un analizador dedicado que admite prompts de herramientas basadas en texto, lo que permite que el agente funcione sin problemas incluso en entornos de LLM locales, no solo con modelos en la nube de alto rendimiento.
- **Seguridad robusta y control del usuario (Human-in-the-Loop):** Las operaciones destructivas como la modificación de contenido, la eliminación de archivos o la ejecución de código no pueden ser procesadas por el agente por sí solo. Se ejecutan de forma segura con copias de seguridad de protección contra sobreescritura solo después de preguntar al usuario con una interfaz de usuario (visor de diferencias y modal de advertencia de tarea) y recibir la aprobación final (Aceptar).
- **Prevención de costos y límites:** Se aplican límites predeterminados en el recuento de uso de herramientas y en la longitud de caracteres agregados para evitar fallos de la IA o bucles infinitos. (Estos límites se pueden ajustar libremente en la configuración avanzada).
- **Cómo usar:** Escriba el comando `/mcp` en el chat o use el icono superior para abrir la ventana emergente rápida y habilitar el 'Modo Agente'. (El servidor interno de Lumina se iniciará automáticamente según sea necesario para ejecutar las herramientas).
</details>

<details>
<summary><b>🔌 Integración MCP (Soporte Bidireccional Cliente y Servidor)</b></summary>

- **Descripción:** Conecta perfectamente Obsidian con el ecosistema de IA más amplio a través del Protocolo de Contexto de Modelos (MCP). ¡Utiliza Obsidian como un centro de IA todo en uno, o aprovéchalo como el segundo cerebro de tu IA!
- **💻 Modo Cliente (Dirigido por Obsidian):**
  - Interactúa y trabaja directamente con IA dentro de Obsidian.
  - Conecta numerosos servidores MCP externos (GitHub, bases de datos locales, búsqueda web, etc.) para extraer (scrape) y organizar instantáneamente grandes cantidades de datos en tus notas.
- **🖥️ Modo Servidor (Dirigido por IA Externa):**
  - Proporciona varias herramientas que permiten a asistentes de IA externos (Claude, Cursor, etc.) o a la IA en Modo Agente acceder directamente a tu bóveda.
  - **Búsqueda Web:** `lumina_web_search` (Búsqueda de información en Internet en tiempo real utilizando varios motores de búsqueda como Tavily, Exa, Google, con soporte de truncamiento inteligente)
  - **Lectura y Búsqueda:** `read_active_note`, `read_note`, `search_notes` (admite filtrado de etiquetas), `list_notes`, `rag_search`, `get_backlinks`, `get_note_metadata`, `list_attachments`, `list_tags`, `query_metadata` para proporcionar un contexto amplio a la IA.
  - **Escritura y Modificación:** `create_note`, `append_to_note`, `replace_note`, `patch_note`, `update_frontmatter`, `save_attachment`, `create_canvas`, `generate_moc`, `auto_link_note` (crear/modificar notas/lienzos (canvas), generar notas MOC (Map of Content) y guardar archivos binarios).
  - **Gestión y Ejecución:** `delete_note`, `move_note` (mover/renombrar), `execute_code`, `run_note_code_block` (ejecutar código en un entorno seguro o sandbox, `run_shell_command` (ejecutar comandos de shell de terminal en el sistema operativo de escritorio).
- **Nota:** *Lumina cuenta con mecanismos de seguridad de múltiples capas, que incluyen la ejecución de código en sandbox, aprobaciones de usuario basadas en un visor de diferencias en tiempo real (Human-in-the-Loop), copias de seguridad automáticas durante las modificaciones de archivos (protección contra sobreescritura) y límites para evitar bucles infinitos. Sin embargo, dado que el agente y la IA externa acceden directamente a su vault, recomendamos monitorear las operaciones de cerca inicialmente.*
  - **Seguridad Robusta y Control del Usuario:** Operaciones destructivas como la modificación de contenido, eliminación de archivos o ejecución de código no pueden ser procesadas por el agente de forma independiente. Se ejecutan de forma segura con copias de seguridad de protección contra sobrescritura, solo después de mostrar al usuario una interfaz (Visor de Diferencias y Modal de Advertencia de Tarea) y recibir la aprobación final (Accept).
- **Cómo usar:** Habilita las características MCP en la configuración del plugin y configura el método de transporte cliente/servidor (SSE).
- **Nota:** *Lumina cuenta con mecanismos de seguridad de múltiples capas, que incluyen la ejecución de código en sandbox, aprobaciones de usuario basadas en un visor de diferencias en tiempo real (Human-in-the-Loop), copias de seguridad automáticas durante las modificaciones de archivos (protección contra sobreescritura) y límites para evitar bucles infinitos. Sin embargo, dado que el agente y la IA externa acceden directamente a su vault, recomendamos monitorear las operaciones de cerca inicialmente.*
</details>

---

## 🐛 Modo de Depuración e Informes de Errores

Puedes ver todos los datos internos procesados por el plugin habilitando la Configuración Avanzada y activando el [Modo de Depuración] bajo la pestaña [Varios y extensiones] en la configuración. (Los registros de depuración no se guardan hasta que se descargan).

**💡 Información Útil para la Resolución:**
- Tu sistema operativo (Windows, macOS, Linux) y la versión de Obsidian.
- El Proveedor de IA y Nombre del Modelo utilizado (ej., OpenAI / gpt-4o, Ollama / llama3).
- El archivo de registro descargado después de que ocurrió el error en Modo de Depuración.
> [!IMPORTANT]
> Dado que los archivos de registro pueden contener transcripciones de chat, elimina cualquier información confidencial antes de enviar.
> **[Reportar un Error (GitHub Issues)](https://github.com/lumina-apps/obsidian-lumina/issues)**

---

## ☕ Apoyo y Patrocinio

Este plugin se distribuye 100% de forma gratuita y se actualizará continuamente.

👉 **[Ko-fi](https://ko-fi.com/luminaapps)**  
👉 **[Ctee](https://ctee.kr/place/luminaapps)**