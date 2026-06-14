# 🚀 Lumina: 올인원 AI 어시스턴트 (RAG + MCP + Agent)

**`Lumina`는 다중 LLM, 제로 컨피그 RAG, 양방향 MCP 연동, 그리고 자율 AI 에이전트를 하나로 결합하여 내 지식 베이스를 완벽한 AI 허브로 만들어주는 옵시디언용 강력한 올인원 어시스턴트 플러그인입니다.**

<p align="center">
  <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/README.md">English</a> | <b>한국어</b> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_JA.md">日本語</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ZH.md">简体中文</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ZH_TW.md">繁體中文</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_ES.md">Español</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_DE.md">Deutsch</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_FR.md">Français</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_PT.md">Português</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_RU.md">Русский</a> | <a href="https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_IT.md">Italiano</a>
</p>

> 🌐 **다국어 환경 최적화 완료!** 내장 임베딩 모델과 UI가 다국어 및 한국어 환경에 맞게 완벽히 현지화되어 있습니다. (번역 피드백은 언제나 환영합니다!)

![alt text](readme.gif)

---

## 🌟 주요 기능

| 기능 | 설명 |
| :--- | :--- |
| **💬 멀티 LLM 채팅 뷰** | 내 노트의 문맥을 이해하는 전용 사이드 패널. 강력한 클라우드 모델부터 프라이버시를 위한 로컬 LLM까지 모두 지원합니다. |
| **🧠 제로 컨피그 RAG** | 데이터 유출 없는 100% 오프라인 로컬 임베딩을 지원하며, 복잡한 설정 없이 실시간으로 자동 인덱싱됩니다. |
| **⚡ 인라인 AI 퀵 액션** | 글쓰기 흐름을 끊지 않고, 에디터 안에서 텍스트를 드래그해 즉시 요약·번역·교정을 실행합니다. |
| **🤖 자율 AI 에이전트** | LLM이 MCP 도구를 활용해 스스로 계획을 세우고 노트 검색, 생성, 수정 등의 복잡한 작업을 자율적으로 수행합니다. (실험적 기능) |
| **🔌 MCP 연동 (Client & Server)** | 옵시디언 안에서 외부 도구를 마음껏 쓰거나(Client), 반대로 외부 AI가 내 노트를 직접 다루게(Server) 만드는 양방향 풀스택 연동 기능입니다. (실험적 기능) |

---

## ⚡ 빠른 시작 (Quick Start)

1. 옵시디언 '커뮤니티 플러그인'에서 `Lumina`를 **설치**하고 활성화합니다.
2. 플러그인이 켜지면 내장된 RAG 모델이 자동으로 노트를 분석하기 시작합니다. (사이드 패널에서 스마트 탐색 기능 사용 가능)
3. **[AI 채팅 사용 설정]** 옵시디언 설정 ➔ `Lumina` 탭으로 이동합니다.
4. 원하는 LLM 제공자를 추가하고 API 키를 입력합니다.
   - 💻 **로컬 LLM (Ollama, LM Studio 등)** 사용 시 API 키 입력 없이 바로 연결 가능!
   - ☁️ **클라우드 LLM** 사용 시 아래 링크에서 무료 API 키를 쉽게 발급받을 수 있습니다.
     - 👉 [Google Gemini API 키 발급받기 (무료)](https://aistudio.google.com/app/apikey)
     - 👉 [Groq API 키 발급받기 (무료)](https://console.groq.com/keys)
5. **[채팅창 열기 및 기본 사용]** 왼쪽 리본 메뉴의 💬 아이콘을 눌러 채팅 뷰를 열고 AI와 대화를 시작하거나, 에디터에서 텍스트를 드래그한 뒤 우클릭하여 퀵 액션을 실행해 봅니다.
6. **[에이전트 기능 켜기]** 채팅창 내에서 `/mcp` 명령어를 입력하거나 퀵 팝업 메뉴를 열어 **🤖 에이전트 모드(Agent Mode)**를 활성화합니다.
   - *팁: 에이전트의 자율 작업을 위해 필요한 Lumina 내장 서버가 백그라운드에서 자동으로 함께 시작됩니다.*
7. **자율 작업 지시하기:** 에이전트 모드가 활성화된 상태에서 "내 보관소에서 '인공지능' 관련 노트를 모두 찾아서 핵심 내용을 요약하고 새 노트로 정리해줘"와 같이 복잡한 작업을 지시해 보세요. AI가 스스로 필요한 도구들을 판단하고 실행하며 자율적으로 작업을 완수합니다.

> [!IMPORTANT]
> **🔒 API 키 안전 보관 안내**
> 입력하신 모든 API 키는 절대 일반 텍스트 파일로 저장되지 않습니다. 옵시디언 자체 보안 저장소(`SecretStorage`)를 통해 안전하게 암호화되어 로컬에만 보관되니 안심하고 사용하셔도 됩니다.

---

## ✨ 상세 기능 및 활용법 (클릭하여 펼치기)

<details>
<summary><b>💬 멀티 LLM 채팅 뷰 (클라우드 & 로컬 지원)</b></summary>

- **기능 설명:** 옵시디언 내부에 전용 사이드 패널을 띄워 다양한 AI 모델과 즉시 대화할 수 있습니다. Gemini, Groq 같은 강력한 클라우드 모델은 물론, 완벽한 프라이버시를 보장하는 **로컬 LLM**(Ollama, LM Studio 등) 연동도 완벽하게 지원합니다.
- **사용 방법:** 왼쪽 리본 메뉴의 💬 아이콘을 클릭하거나, 명령어 팔레트에서 `Lumina: Chat 열기`를 실행하세요. 
- **💡 꿀팁:** 에디터에서 텍스트를 드래그한 뒤 우클릭 메뉴를 사용하면, 선택한 텍스트를 바로 채팅창의 문맥(Context)으로 던져넣고 질문할 수 있습니다!
</details>

<details>
<summary><b>🧠 RAG 기반 대화 & 로컬 임베딩 (완벽한 프라이버시)</b></summary>

- **기능 설명:** AI가 내 지식 베이스를 꿰뚫어 봅니다. 대화 중 관련 노트를 스스로 찾아보고, 사이드 패널에 현재 문맥에 맞는 유사 문서와 추천 태그를 띄워 스마트한 연결 고리를 만들어 줍니다.
- **오프라인 보안:** 로컬 임베딩(`ibm-granite`)을 기본 지원합니다. 클라우드 모델을 선택하지 않는 한, 내 소중한 노트 데이터는 외부 서버로 절대 유출되지 않습니다.
- **완전 자동화:** 별도의 설정이 필요 없습니다! 플러그인을 활성화하는 즉시 백그라운드 인덱싱이 조용히 시작되며, 노트를 수정할 때마다 실시간(`watch` 모드)으로 알아서 동기화됩니다.
</details>

<details>
<summary><b>⚡ 에디터 인라인 AI (퀵 액션)</b></summary>

- **기능 설명:** 글을 쓰는 흐름을 끊지 않고 마크다운 에디터 내에서 텍스트를 즉시 변환합니다. 선택한 텍스트의 번역, 요약, 문법 교정 및 상세 설명을 손쉽게 처리할 수 있습니다.
- **사용 방법:** 텍스트를 드래그하여 선택한 뒤, 인라인 팝업 메뉴나 명령어 팔레트를 통해 퀵 액션을 실행하세요. *(💡 팁: 옵시디언 설정에서 단축키를 지정해 두면 훨씬 더 빠르게 사용할 수 있습니다!)*
</details>

<details>
<summary><b>🤖 자율 AI 에이전트 (에이전트 모드) ⚠️</b></summary>

- **기능 설명:** 활성화 시 LLM이 MCP 도구들을 자율적으로 판단하고 조합하여 작업을 수행합니다. 노트 검색, 읽기, 쓰기 및 RAG 검색 등을 연계하여 복잡한 다단계 작업을 스스로 완수할 수 있습니다.
- **로컬 LLM 지원:** 고성능 클라우드 모델뿐만 아니라, 로컬 LLM 환경에서도 텍스트 기반 툴 프롬프팅을 지원하여 로컬 모델에서도 에이전트가 원활히 작동하도록 전용 파서가 구현되어 있습니다.
- **안전 장치:** 무한 루프나 과도한 API 호출로 인한 비용 발생을 방지하기 위해 단일 요청당 최대 실행 단계 제한(기본 15단계)이 작동하며, 동일한 도구의 반복 호출이 감지되면 실행을 자동으로 중단합니다.
- **사용 방법:** 채팅창에서 `/mcp` 명령어를 입력하거나 상단 아이콘을 통해 퀵 팝업을 열고 '에이전트 모드'를 활성화하세요. (도구 실행을 위해 Lumina 내장 서버가 필요에 따라 자동으로 함께 켜집니다.)
</details>

<details>
<summary><b>🤖 MCP 연동 (클라이언트 & 서버 양방향 지원) ⚠️</b></summary>

- **기능 설명:** 모델 컨텍스트 프로토콜(MCP)을 통해 옵시디언과 AI 생태계를 완벽하게 연결합니다. 옵시디언을 만능 AI 허브로 쓰거나, AI의 세컨드 브레인으로 활용해 보세요!
- **💻 클라이언트 모드 (옵시디언이 주도):**
  - 옵시디언 내부에서 AI와 직접 대화하며 작업
  - 수많은 외부 MCP 서버(GitHub, 로컬 DB, 웹 검색 등)를 연결해 방대한 데이터를 내 노트로 즉시 스크랩 및 정리
- **🖥️ 서버 모드 (외부 AI가 주도):**
  - 외부 AI(Claude, Cursor 등)가 내 볼트에 직접 접근할 수 있도록 7가지 도구 제공
  - `read_active_note`, `read_note`, `search_notes`, `list_notes`, `rag_search`: 내 노트의 문맥과 지식을 AI에게 제공
  - `create_note`, `append_to_note`: AI가 정리한 아이디어를 내 볼트에 안전하게 직접 작성 (덮어쓰기 방지 적용)
  - `read_daily_note`, `append_to_daily_note`: 오늘 날짜의 데일리 노트 읽기/쓰기 연동
- **사용 방법:** 플러그인 설정 메뉴에서 MCP 기능을 켜고, 클라이언트/서버 전송 방식(SSE)을 구성하세요.
- **주의 사항:** *에이전트 및 MCP 기능은 아직 실험적(Beta) 단계입니다. 덮어쓰기 방지 및 글자 수 제한 등 다양한 안전장치가 구현되어 있으나, 외부 AI가 노트를 직접 편집하므로 처음에는 동작을 가볍게 확인하며 사용하시는 것을 권장합니다.*
</details>

---

## 🐛 디버그 모드 및 버그 신고

설정의 [부가 기능 및 기타] 탭에서 고급 설정을 켜고 [디버그 모드]를 켜면 플러그인 내부에서 처리하는 모든 데이터를 확인하실 수 있습니다. (디버그 로그는 다운로드 전에는 저장되지 않습니다.)

**💡 해결에 도움이 되는 정보 및 링크:**
- 사용 중인 OS (Windows, macOS, Linux) 및 옵시디언 버전
- 사용한 AI 프로바이더(제공자) 및 모델명 (예: OpenAI / gpt-4o, Ollama / llama3)
- 디버그 모드에서 오류작동 후 다운로드한 로그 파일
> [!IMPORTANT]
> 로그 파일에 채팅 내용이 포함될 수 있으니, 민감한 정보는 삭제 후 신고해 주세요.
> **[버그 신고하기 (GitHub Issues)](https://github.com/lumina-apps/obsidian-lumina/issues)**

---

## ☕ 후원하기

이 플러그인은 100% 무료로 배포되며, 지속적으로 업데이트될 예정입니다.  
후원이 들어오면 신나서 업데이트를 많이 할 겁니다.

👉 **[GitHub Sponsor](https://github.com/sponsors/lumina-apps)**  
👉 **[Ko-fi](https://ko-fi.com/luminaapps)**  
👉 **[Ctee](https://ctee.kr/place/luminaapps)**