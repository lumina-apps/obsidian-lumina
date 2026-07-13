import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ChatController } from './chatController';
import { getMessages, resetChat, currentSessionId } from '../../core/store/chatStore';
import { createProvider } from '../../core/llm-providers/index';
import { saveSession } from './history';
import { get } from 'svelte/store';

// ─── 1. llm-providers Mocking ────────────────────────────────────────────────
vi.mock('../../core/llm-providers/index', () => {
	const mockProviderInstance = {
		stream: vi.fn().mockImplementation(async (messages: any, options: any, chunkCallback: (chunk: string) => void) => {
			// 시뮬레이션: 약간의 딜레이를 두고 청크 방출
			await new Promise(resolve => setTimeout(resolve, 10));
			chunkCallback('Hello ');
			await new Promise(resolve => setTimeout(resolve, 10));
			chunkCallback('this is a ');
			await new Promise(resolve => setTimeout(resolve, 10));
			chunkCallback('mocked stream response.');
			return { usage: { promptTokens: 10, completionTokens: 15 }, finishReason: 'stop' };
		}),
		chat: vi.fn().mockResolvedValue({
			content: 'Mocked non-stream response.',
			usage: { promptTokens: 10, completionTokens: 12 },
			finishReason: 'stop',
		}),
	};

	return {
		createProvider: vi.fn().mockReturnValue(mockProviderInstance),
		isLocalProvider: vi.fn().mockReturnValue(false),
	};
});

// ─── 2. History Persistence Mocking ──────────────────────────────────────────
vi.mock('./history', () => {
	return {
		saveSession: vi.fn().mockResolvedValue(undefined),
		generateTitle: vi.fn().mockReturnValue('Mocked Session Title'),
		generateTitleWithLLM: vi.fn().mockResolvedValue('Mocked Session Title'),
	};
});

// ─── 3. Obsidian App Mocking ─────────────────────────────────────────────────
vi.mock('obsidian', () => {
	return {
		normalizePath: (p: string) => p,
		Notice: vi.fn(),
	};
});

// ─── 4. Project Store Mocking ────────────────────────────────────────────────
vi.mock('../../core/store/projectStore', () => {
	return {
		getActiveProject: vi.fn().mockReturnValue({
			id: 'default',
			historySubfolder: '',
		}),
	};
});

describe('Chat Flow & Saving Integration', () => {
	let mockPlugin: any;

	beforeEach(() => {
		resetChat();
		vi.useFakeTimers();
		vi.clearAllMocks();

		const mockVault = {
			configDir: '.obsidian',
			getMarkdownFiles: vi.fn().mockReturnValue([]),
			read: vi.fn().mockResolvedValue(''),
			adapter: {
				exists: vi.fn().mockResolvedValue(true),
				write: vi.fn().mockResolvedValue(undefined),
				mkdir: vi.fn().mockResolvedValue(undefined),
			},
		};

		mockPlugin = {
			app: {
				vault: mockVault,
				workspace: {
					getActiveFile: vi.fn().mockReturnValue(null),
				},
			},
			settings: {
				chat: {
					historyPath: 'chat_history',
					autoSaveHistory: true,
					streaming: true,
					temperature: 0.7,
					maxOutputTokens: 1000,
					ttftTimeoutMs: 5000,
					interTokenTimeoutMs: 5000,
					agentEnabled: false,
					agentExecutionMode: 'read',
					systemPrompts: [],
				},
				mcp: {
					clientToolsEnabled: false,
				},
				connections: {
					ragEnabled: false,
					providers: [
						{
							id: 'test-provider-1',
							name: 'Test LLM Provider',
							type: 'openai',
							isVerified: true,
							availableModels: ['model-abc'],
						},
					],
				},
				rag: {
					includeActiveNote: false,
				},
				webSearch: {
					enabled: false,
				},
			},
			saveSettings: vi.fn().mockResolvedValue(undefined),
		};
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it('should add messages, stream LLM response, and trigger auto save after 3-second debounce', async () => {
		const controller = new ChatController(mockPlugin);

		// 세션 ID 사전 세팅 (디버그 로그 저장 지연 방지)
		currentSessionId.set('test-session-123');

		// 1. 메시지 전송 시작
		const sendPromise = controller.sendMessage(
			'What is the project info?',
			[],
			'test-provider-1',
			'model-abc'
		);

		// 2. 비동기 스트림 수행을 위해 타이머를 일부 진행시켜 프로미스 체인 실행
		await vi.advanceTimersByTimeAsync(100);
		await sendPromise;

		// 메시지 보관소 검증
		const msgs = getMessages();
		expect(msgs.length).toBe(2);

		// 사용자 메시지
		expect(msgs[0].role).toBe('user');
		expect(msgs[0].content).toBe('What is the project info?');

		// 어시스턴트 메시지
		expect(msgs[1].role).toBe('assistant');
		expect(msgs[1].content).toBe('Hello this is a mocked stream response.');
		expect(msgs[1].isStreaming).toBe(false);

		// 3. 디바운스 대기 중 상태 검증 (스트리밍 완료 후 3초 미만 시점)
		// 아직 saveSession이 호출되지 않아야 함
		expect(saveSession).not.toHaveBeenCalled();

		// 4. 타이머를 3초 앞으로 진전
		await vi.advanceTimersByTimeAsync(3000);

		// 히스토리 저장 호출 완료 확인
		expect(saveSession).toHaveBeenCalled();
	});
});
