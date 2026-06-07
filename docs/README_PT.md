# 🚀 Lumina: Assistente de IA Tudo-em-Um (RAG + MCP + Agent)

**`Lumina` é um poderoso plugin assistente tudo-em-um para o Obsidian que transforma a sua base de conhecimento num hub de IA completo, combinando suporte multi-LLM, RAG sem configuração, integração MCP bidirecional e agentes de IA autônomos.**

<p align="center">
  <a href="/README.md">English</a> | <a href="/docs/README_KO.md">한국어</a> | <a href="/docs/README_JA.md">日本語</a> | <a href="/docs/README_ZH.md">简体中文</a> | <a href="/docs/README_ZH_TW.md">繁體中文</a> | <a href="/docs/README_ES.md">Español</a> | <a href="/docs/README_DE.md">Deutsch</a> | <a href="/docs/README_FR.md">Français</a> | <b>Português</b> | <a href="/docs/README_RU.md">Русский</a> | <a href="/docs/README_IT.md">Italiano</a>
</p>

> 🌐 **Otimizado para Ambientes Multilíngues!** Os modelos de incorporação (embeddings) integrados e a interface do utilizador estão totalmente localizados para ambientes multilíngues. (Comentários sobre a tradução são sempre bem-vindos!)

![alt text](readme.gif)

---

## 🌟 Principais Funcionalidades

| Funcionalidade | Descrição |
| :--- | :--- |
| **💬 Vista de Chat Multi-LLM** | Um painel lateral dedicado que entende o contexto das suas notas. Suporta desde poderosos modelos na nuvem até LLMs locais para máxima privacidade. |
| **🧠 RAG Sem Configuração** | Oferece incorporações locais 100% offline para evitar fugas de dados. Indexa automaticamente o seu cofre em tempo real sem configurações complexas. |
| **⚡ Ações Rápidas de IA Embutidas** | Destaque texto no editor para resumir, traduzir ou rever instantaneamente sem interromper o seu fluxo de escrita. |
| **🤖 Agente de IA Autônomo** | LLMs planeiam e executam de forma autónoma tarefas complexas como pesquisar, criar e modificar notas utilizando ferramentas MCP. (Experimental) |
| **🔌 Integração MCP (Cliente e Servidor)** | Uma integração bidirecional completa que lhe permite utilizar ferramentas externas dentro do Obsidian (Cliente), ou deixar que IAs externas interajam com as suas notas (Servidor). (Experimental) |

---

## ⚡ Início Rápido

1. **Instale** e ative o `Lumina` a partir dos Plugins Comunitários do Obsidian.
2. Uma vez ativado, o modelo RAG integrado começará automaticamente a analisar as suas notas em segundo plano. (A navegação inteligente fica disponível no painel lateral).
3. **[Ativar Chat de IA]** Navegue para Configurações do Obsidian ➔ `Lumina`.
4. Adicione o seu provedor de LLM preferido e introduza as suas chaves de API.
   - 💻 **LLMs Locales (Ollama, LM Studio, etc.)** podem ser conectados instantaneamente sem chaves de API!
   - ☁️ **LLMs na Nuvem** requerem chaves de API, que podem ser facilmente obtidas de forma gratuita:
     - 👉 [Obter Chave de API Google Gemini (Grátis)](https://aistudio.google.com/app/apikey)
     - 👉 [Obter Chave de API Groq (Grátis)](https://console.groq.com/keys)
5. **[Abrir Chat e Uso Básico]** Clique no ícone 💬 no menu lateral esquerdo para abrir a Vista de Chat e começar a interagir com a IA, ou destaque texto no editor e clique com o botão direito para acionar Ações Rápidas.
6. **[Ativar Modo Agente]** Digite o comando `/mcp` no chat ou abra o menu pop-up rápido para ativar o **🤖 Modo Agente**.
   - *Dica: O servidor interno do Lumina necessário para as operações autônomas do agente será iniciado automaticamente em segundo plano.*
7. **Atribuir Tarefas Autônomas:** Com o Modo Agente ativo, dê instruções complexas como: "Encontra todas as notas relacionadas com 'Inteligência Artificial' no meu cofre, resume os pontos-chave e organiza-os numa nova nota." A IA determinará e executará de forma autônoma as ferramentas necessárias para concluir a tarefa.

> [!IMPORTANT]
> **🔒 Armazenamento Seguro de Chaves API**
> Todas as chaves de API que você introduz nunca são armazenadas como ficheiros de texto simples. Elas são encriptadas de forma segura e armazenadas localmente através do `SecretStorage` integrado do Obsidian, garantindo que os seus dados permanecem seguros.

---

## ✨ Funcionalidades Detalhadas e Utilização (Clique para Expandir)

<details>
<summary><b>💬 Vista de Chat Multi-LLM (Suporte Local e na Nuvem)</b></summary>

- **Descrição:** Converse instantaneamente com vários modelos de IA através de um painel lateral dedicado dentro do Obsidian. Suporta totalmente modelos poderosos na nuvem como Gemini e Groq, bem como **LLMs Locais** (Ollama, LM Studio, etc.) para privacidade absoluta.
- **Como utilizar:** Clique no ícone 💬 na fita esquerda ou execute `Lumina: Open Chat` a partir da paleta de comandos.
- **💡 Dica Pro:** Destaque texto no editor, clique com o botão direito e use o menu contextual para injetar diretamente o texto selecionado no chat como contexto para as suas perguntas!
</details>

<details>
<summary><b>🧠 Chat Baseado em RAG e Incorporações Locais (Privacidade Absoluta)</b></summary>

- **Descrição:** A IA obtém uma visão profunda da sua base de conhecimento. Ela pesquisa de forma autônoma notas relevantes durante as conversas e exibe documentos semelhantes e tags recomendadas no painel lateral, criando links contextuais inteligentes.
- **Segurança Offline:** Suporta nativamente incorporações (embeddings) locais (`ibm-granite`). A menos que um modelo na nuvem seja selecionado, os seus valiosos dados de notas nunca sairão do seu dispositivo. *(⚠️ Incorporações locais não são suportadas em ambientes móveis).*
- **Totalmente Automatizado:** Nenhuma configuração é necessária! A indexação em segundo plano começa silenciosamente no momento em que o plugin é ativado e sincroniza automaticamente em tempo real (modo `watch`) sempre que as notas são modificadas.
</details>

<details>
<summary><b>⚡ IA Embutida no Editor (Ações Rápidas)</b></summary>

- **Descrição:** Transforme instantaneamente texto no editor markdown sem interromper o seu fluxo de escrita. Lide facilmente com tradução, resumo, correção gramatical e explicações detalhadas para o texto selecionado.
- **Como utilizar:** Destaque o texto e execute Ações Rápidas através do menu pop-up embutido ou da paleta de comandos. *(💡 Dica: Atribua atalhos de teclado nas configurações do Obsidian para acesso ultrarrápido!)*
</details>

<details>
<summary><b>🤖 Agente de IA Autônomo (Modo Agente) ⚠️</b></summary>

- **Descrição:** Quando ativado, o LLM determina e orquestra de forma autônoma as ferramentas MCP para realizar tarefas. Ele pode concluir operações complexas de várias etapas combinando pesquisa, leitura, escrita de notas e recuperação RAG.
- **Suporte para LLM Local:** Implementa um analisador dedicado que suporta "tool prompting" baseado em texto, permitindo que o agente funcione sem problemas mesmo em ambientes LLM Locais, não apenas com modelos na nuvem de alto desempenho.
- **Mecanismos de Segurança:** Para evitar loops infinitos ou custos excessivos de API, é imposto um limite máximo de etapas de execução por solicitação (padrão: 15 etapas). A execução é abortada automaticamente se forem detetadas chamadas repetidas de ferramentas.
- **Como utilizar:** Digite o comando `/mcp` no chat ou use o ícone superior para abrir o pop-up rápido e ativar o 'Modo Agente'. (O servidor interno Lumina iniciará automaticamente conforme necessário para executar as ferramentas.)
</details>

<details>
<summary><b>🤖 Integração MCP (Suporte Bidirecional Cliente e Servidor) ⚠️</b></summary>

- **Descrição:** Conecta perfeitamente o Obsidian com o ecossistema de IA mais amplo através do Model Context Protocol (MCP). Use o Obsidian como um hub de IA tudo-em-um, ou tire partido dele como o segundo cérebro da sua IA!
- **💻 Modo Cliente (Liderado pelo Obsidian):**
  - Interaja e trabalhe diretamente com a IA dentro do Obsidian.
  - Conecte vários servidores MCP externos (GitHub, bases de dados locais, pesquisa na web, etc.) para extrair e organizar instantaneamente grandes quantidades de dados nas suas notas.
- **🖥️ Modo Servidor (Liderado por IA Externa):**
  - Expõe 7 ferramentas que permitem que assistentes de IA externos (Claude, Cursor, etc.) acedam diretamente ao seu cofre.
  - `read_active_note`, `read_note`, `search_notes`, `rag_search`: Fornece o contexto e o conhecimento do seu cofre à IA.
  - `create_note`, `append_to_note`: Permite que a IA escreva de forma segura ideias organizadas diretamente no seu cofre (proteção contra substituição aplicada).
  - `read_daily_note`, `append_to_daily_note`: Integração de leitura/escrita para a nota diária de hoje.
- **Como utilizar:** Ative as funcionalidades MCP nas configurações do plugin e configure os métodos de transporte cliente/servidor (stdio/SSE).
- **Nota:** *As funcionalidades de Agente e MCP estão atualmente na fase Experimental (Beta). Conexões Stdio não são suportadas em dispositivos móveis. Embora várias redes de segurança, como proteção contra substituição e limites de caracteres, estejam em vigor, recomendamos monitorizar de perto as operações inicialmente, pois IAs externas editarão diretamente as suas notas.*
</details>

---

## 🐛 Modo de Depuração e Relatórios de Bugs

Pode visualizar todos os dados internos processados pelo plugin ativando as Configurações Avançadas e ativando o [Modo de Depuração] sob a aba [Complementos e Diversos] nas configurações. (Os logs de depuração não são guardados até serem descarregados).

**💡 Informações Úteis para Resolução:**
- O seu Dispositivo/SO (PC / Mobile) e a versão do Obsidian.
- O Provedor de IA e o Nome do Modelo utilizado (ex., OpenAI / gpt-4o, Ollama / llama3).
- O ficheiro de log descarregado após o erro ter ocorrido no Modo de Depuração.
> [!IMPORTANT]
> Uma vez que os ficheiros de log podem conter transcrições de chat, remova qualquer informação sensível antes de enviar.
> **[Reportar um Bug (GitHub Issues)](https://github.com/lumina-apps/obsidian-lumina/issues)**

---

## ☕ Suporte e Patrocínio

Este plugin é distribuído 100% de forma gratuita e será continuamente atualizado.
Os patrocínios mantêm-me motivado para lançar atualizações ainda mais rápido!

👉 **[GitHub Sponsor](https://github.com/sponsors/lumina-apps)**  
👉 **[Ko-fi](https://ko-fi.com/luminaapps)**  
👉 **[Ctee](https://ctee.kr/place/luminaapps)**
