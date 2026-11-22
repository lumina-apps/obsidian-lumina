import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { App, Platform } from 'obsidian';
import type { LLMProviderConfig } from '../../../shared/types/settings.types';
import { resolveSttEngine } from '../stt/sttResolver';
import { DEFAULT_VOICE_PREFERENCES } from '../voicePreferences';

describe('sttResolver', () => {
	const origIsMobile = Platform.isMobile;
	const app = new App();

	beforeEach(() => {
		(Platform as { isMobile: boolean }).isMobile = false;
	});

	afterEach(() => {
		(Platform as { isMobile: boolean }).isMobile = origIsMobile;
	});

	it('auto 모드에서는 Groq -> OpenAI -> Google -> Custom 순으로 연결된 STT를 선택한다', () => {
		const google: LLMProviderConfig = {
			id: 'g1',
			type: 'google',
			credential: 'AIza',
			availableModels: ['gemini-2.5-flash'],
			isVerified: true,
		};
		const openai: LLMProviderConfig = {
			id: 'o1',
			type: 'openai',
			credential: 'sk-oai',
			availableModels: ['gpt-4o'],
			isVerified: true,
		};
		const groq: LLMProviderConfig = {
			id: 'gr1',
			type: 'groq',
			credential: 'gsk',
			availableModels: ['llama-3.3-70b'],
			isVerified: true,
		};

		expect(resolveSttEngine(app, [google, openai, groq], DEFAULT_VOICE_PREFERENCES).id).toBe('stt-groq-gr1');
		expect(resolveSttEngine(app, [google, openai], DEFAULT_VOICE_PREFERENCES).id).toBe('stt-openai-o1');
		expect(resolveSttEngine(app, [google], DEFAULT_VOICE_PREFERENCES).id).toBe('stt-google-g1');
	});

	it('Claude 단독 연결 시 데스크톱에서는 무료 로컬 Whisper로 폴백한다', () => {
		const claude: LLMProviderConfig = {
			id: 'a1',
			type: 'anthropic',
			credential: 'sk-ant',
			availableModels: ['claude-sonnet-4'],
			isVerified: true,
		};

		const engine = resolveSttEngine(app, [claude], DEFAULT_VOICE_PREFERENCES);
		expect(engine.id).toBe('stt-local-whisper');
	});

	it('Claude 단독 연결 상태에서 모바일 환경이면 명확한 안내 에러를 발생시킨다', () => {
		(Platform as { isMobile: boolean }).isMobile = true;
		const claude: LLMProviderConfig = {
			id: 'a1',
			type: 'anthropic',
			credential: 'sk-ant',
			availableModels: ['claude-sonnet-4'],
			isVerified: true,
		};

		expect(() => resolveSttEngine(app, [claude], DEFAULT_VOICE_PREFERENCES)).toThrowError();
	});

	it('provider 수동 지정 시 해당 프로바이더 엔진을 우선 선택한다', () => {
		const openai: LLMProviderConfig = {
			id: 'o1',
			type: 'openai',
			credential: 'sk-oai',
			availableModels: ['gpt-4o'],
			isVerified: true,
		};
		const groq: LLMProviderConfig = {
			id: 'gr1',
			type: 'groq',
			credential: 'gsk',
			availableModels: ['llama-3.3-70b'],
			isVerified: true,
		};

		const engine = resolveSttEngine(app, [groq, openai], {
			...DEFAULT_VOICE_PREFERENCES,
			sttMode: 'provider',
			sttProviderId: 'o1',
		});
		expect(engine.id).toBe('stt-openai-o1');
	});

	it('local-whisper 모드는 모바일에서 차단된다', () => {
		(Platform as { isMobile: boolean }).isMobile = true;
		expect(() =>
			resolveSttEngine(app, [], {
				...DEFAULT_VOICE_PREFERENCES,
				sttMode: 'local-whisper',
			}),
		).toThrowError();
	});
});
