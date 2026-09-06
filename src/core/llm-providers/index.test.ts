import { describe, it, expect } from 'vitest';
import { createProvider } from './index';
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
});
