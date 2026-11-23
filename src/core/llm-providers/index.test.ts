import { describe, it, expect } from 'vitest';
import { createProvider, isLocalProvider, isLocalEndpointUrl } from './index';
import { Platform } from 'obsidian';
import type { LLMProviderConfig } from '../../shared/types/settings.types';

describe('createProvider factory', () => {
	const baseCliConfig: LLMProviderConfig = {
		id: 'cli-claude-test',
		type: 'cli-claude-code',
		credential: '',
		binaryPath: 'claude',
		availableModels: ['claude-3-7-sonnet'],
		isVerified: true,
	};

	it('데스크톱 환경에서는 CLI 프로바이더가 정상 생성된다', () => {
		(Platform as { isMobile: boolean }).isMobile = false;
		const provider = createProvider(baseCliConfig);
		expect(provider).toBeDefined();
		expect(provider.providerId).toBe('cli-claude-test');
	});

	it('모바일 환경(Platform.isMobile: true)에서는 CLI 프로바이더 생성 시 에러가 발생한다', () => {
		(Platform as { isMobile: boolean }).isMobile = true;
		try {
			expect(() => createProvider(baseCliConfig)).toThrow(
				'CLI agent providers are only supported on Desktop Obsidian.'
			);
		} finally {
			(Platform as { isMobile: boolean }).isMobile = false;
		}
	});

	it('로컬 프로바이더에 baseUrl이 없으면 에러가 발생한다', () => {
		const localConfig: LLMProviderConfig = {
			id: 'ollama-test',
			type: 'ollama',
			credential: '',
			baseUrl: '',
			availableModels: ['llama3'],
			isVerified: true,
		};
		expect(() => createProvider(localConfig)).toThrow();
	});

	it('클라우드 프로바이더에 credential이 없으면 에러가 발생한다', () => {
		const cloudConfig: LLMProviderConfig = {
			id: 'openai-test',
			type: 'openai',
			credential: '',
			availableModels: ['gpt-4o'],
			isVerified: true,
		};
		expect(() => createProvider(cloudConfig)).toThrow();
	});

	it('isLocalProvider는 custom 프로바이더의 baseUrl이 원격 클라우드 도메인인 경우 false를 반환한다', () => {
		expect(isLocalProvider('ollama')).toBe(true);
		expect(isLocalProvider('custom')).toBe(true);
		expect(isLocalProvider('custom', 'http://localhost:8000')).toBe(true);
		expect(isLocalProvider('custom', 'http://192.168.1.50:1234')).toBe(true);
		expect(isLocalProvider('custom', 'https://api.together.xyz/v1')).toBe(false);
		expect(isLocalProvider('custom', 'https://api.mistral.ai/v1')).toBe(false);
		expect(isLocalEndpointUrl('https://api.moonshot.ai/v1')).toBe(false);
	});

	it('모바일 환경에서는 ollama/lmstudio 생성을 차단하고 custom 원격 엔드포인트는 허용한다', () => {
		const origIsMobile = Platform.isMobile;
		(Platform as { isMobile: boolean }).isMobile = true;
		try {
			expect(() =>
				createProvider({
					id: 'ollama-sync',
					type: 'ollama',
					credential: '',
					baseUrl: 'http://localhost:11434',
					availableModels: ['llama3'],
					isVerified: true,
				}),
			).toThrow();

			expect(() =>
				createProvider({
					id: 'lmstudio-sync',
					type: 'lmstudio',
					credential: '',
					baseUrl: 'http://localhost:1234',
					availableModels: ['qwen2.5'],
					isVerified: true,
				}),
			).toThrow();

			const remoteCustom = createProvider({
				id: 'custom-remote',
				type: 'custom',
				credential: 'sk-remote',
				baseUrl: 'https://api.together.xyz/v1',
				availableModels: ['llama-3.3-70b'],
				isVerified: true,
			});
			expect(remoteCustom.providerId).toBe('custom-remote');
		} finally {
			(Platform as { isMobile: boolean }).isMobile = origIsMobile;
		}
	});
});
