import type { LuminaSettings } from './settings.types';

export const DEFAULT_SETTINGS: LuminaSettings = {
	// ── Section 1: Connections & Models ──────────────────────────────────────
	connections: {
		language: 'en', // This will be dynamically set in loadSettings() on first run
		providers: [],
		ragEnabled: true,
		embedding: {
			mode: 'auto',      // 기본값: 내장 transformers.js 모델 사용
			providerId: '',
			modelId: '',
		},
		defaultProviderId: '',
		defaultModelId: '',
		quickActionProviderId: '',
		quickActionModelId: '',
		taskProviderId: '',
		taskModelId: '',
	},

	// ── Section 2: Chat & Prompt ─────────────────────────────────────────────
	chat: {
		systemPrompts: [
			{
				id: 'default',
				name: 'Default',
				content: 'You are a helpful assistant integrated into Obsidian.\nDo not use conversational filler or introductory phrases. Go straight to the point.',
			},
		],
		activeSystemPromptId: 'default',
		autoSaveHistory: true,
		historyPath: 'chatHistory',
		sendKey: 'enter',
		inlineTrigger: '/ai',
		quickActions: [
			{ id: 'qa-summarize', name: '요약하기', prompt: '다음 텍스트를 핵심만 요약해줘:\n\n', actionType: 'append' },
			{ id: 'qa-translate', name: '한국어로 번역', prompt: '다음 텍스트를 자연스러운 한국어로 번역해줘:\n\n', actionType: 'replace' },
			{ id: 'qa-explain', name: '설명하기', prompt: '다음 텍스트에 대해 자세히 설명해줘:\n\n', actionType: 'chat' }
		],

		// Advanced
		memoryMethod: 'auto_summary',
		contextWindowTurns: 10,
		useTokenLimit: false,
		maxContextTokens: 8000,
		temperature: 0.7,
		maxOutputTokens: 2048,
		streaming: true,
		responseLanguage: 'auto',
		agentEnabled: false,
		agentMaxSteps: 15,
	},

	// ── Section 3: RAG & Context ─────────────────────────────────────────────
	rag: {
		dataScope: 'vault',
		includeActiveNote: false,  // 채팅 입력 영역 토글로 이동 → 설정 디폴트는 false
		includedPaths: [],
		excludedPaths: [
			'templates',
			'Templates',
			'_templates',
			'chatHistory',
		],

		// Advanced
		parentChunkSize: 2000,
		parentChunkOverlap: 200,
		childChunkSize: 200,
		childChunkOverlap: 40,
		// 캐시 디스크 저장 주기: 몇 번째 체크포인트마다 저장할지 (1 = 매 체크포인트)
		cachePersistCheckpointInterval: 1,
		topK: 5,
		minSimilarity: 0.0,
		syncMode: 'watch',
		maxFileSizeMB: 50,
	},

	// ── Section 4: Misc & Extensions ─────────────────────────────────────────
	misc: {
		contextMenuEnabled: true,
		showRibbonIcon: true,

		// Advanced
		autoFrontmatter: false,

		debugMode: false,
		hasMigratedChatHistory: false,
	},

	// ── Section 5: MCP (Model Context Protocol) ──────────────────────────────
	mcp: {
		servers: [],
		serverEnabled: false,
		serverPort: 3000,
		serverAuthToken: '',
		serverMaxReadChars: 20000,
		serverSearchSnippetLength: 300,
		serverSearchMaxResults: 10,
		serverMaxAppendChars: 10000,
		clientToolsEnabled: true,
		agentRespectRagExclusions: true,
	},
};
