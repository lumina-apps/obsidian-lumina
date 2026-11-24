import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile, type App } from 'obsidian';
import { resolveAttachmentsWithActiveNote, resolveUseTextTools } from './contextBuilder';
import type { LLMProviderConfig } from '../../../shared/types/settings.types';
import { initProjectStore } from '../../../core/store/projectStore';
import { createDefaultProject } from '../../../shared/types/project.types';
import { settingsStore } from '../../../core/store/settingsStore';

vi.mock('../../../shared/locales/helpers', () => ({
	t: (key: string, vars?: Record<string, string | number>) =>
		vars?.name ? `${key}:${vars.name}` : key,
}));

describe('contextBuilder - resolveAttachmentsWithActiveNote', () => {
	beforeEach(() => {
		const defaultProj = createDefaultProject();
		initProjectStore([defaultProj], defaultProj.id);
		settingsStore.set(null);
	});

	it('사용자 지정 chat.historyPath 하위의 활성 노트는 자동 첨부에서 제외한다', async () => {
		const historyFile = new TFile();
		historyFile.path = 'CustomChats/261122_0800 - Chat.md';
		historyFile.basename = '261122_0800 - Chat';

		const mockApp = {
			workspace: {
				getActiveFile: vi.fn().mockReturnValue(historyFile),
			},
		} as unknown as App;

		const result = await resolveAttachmentsWithActiveNote(
			mockApp,
			[],
			true,
			'/CustomChats/',
		);

		expect(result).toEqual([]);
	});

	it('Lumina Exports 등 일반 노트는 활성 노트로 자동 첨부한다', async () => {
		const exportedFile = new TFile();
		exportedFile.path = 'Lumina Exports/261122_0800 - Summary.md';
		exportedFile.basename = '261122_0800 - Summary';

		const mockApp = {
			workspace: {
				getActiveFile: vi.fn().mockReturnValue(exportedFile),
			},
		} as unknown as App;

		const result = await resolveAttachmentsWithActiveNote(
			mockApp,
			[],
			true,
			'CustomChats',
		);

		expect(result).toHaveLength(1);
		expect(result[0]).toMatchObject({
			type: 'active_note',
			path: 'Lumina Exports/261122_0800 - Summary.md',
		});
	});
});

describe('contextBuilder - resolveUseTextTools', () => {
	const make = (overrides: Partial<LLMProviderConfig>): LLMProviderConfig => ({
		id: 'p1',
		type: 'ollama',
		credential: '',
		availableModels: [],
		isVerified: true,
		...overrides,
	});

	it('로컬 프로바이더는 기본값(useNativeTools 미설정)에서 텍스트 툴 방식을 사용한다', () => {
		expect(resolveUseTextTools(make({ type: 'ollama' }), 'qwen3.6:35b-mlx')).toBe(true);
		expect(resolveUseTextTools(make({ type: 'lmstudio' }), 'qwen2.5')).toBe(true);
	});

	it('로컬 프로바이더에서 useNativeTools를 켜면 네이티브 방식을 사용한다', () => {
		expect(resolveUseTextTools(make({ type: 'ollama', useNativeTools: true }), 'qwen3.6:35b-mlx')).toBe(false);
	});

	it('클라우드 프로바이더는 useNativeTools 값과 무관하게 네이티브 방식을 사용한다', () => {
		expect(resolveUseTextTools(make({ type: 'openai' }), 'gpt-4o')).toBe(false);
		expect(resolveUseTextTools(make({ type: 'openai', useNativeTools: true }), 'gpt-4o')).toBe(false);
	});

	it('원격 custom 엔드포인트는 네이티브 방식을 사용한다', () => {
		expect(resolveUseTextTools(make({ type: 'custom', baseUrl: 'https://api.together.xyz/v1' }), 'llama')).toBe(false);
	});

	it('reasoner/r1 모델은 useNativeTools와 무관하게 텍스트 툴 방식을 유지한다', () => {
		expect(resolveUseTextTools(make({ type: 'deepseek' }), 'deepseek-reasoner')).toBe(true);
		expect(resolveUseTextTools(make({ type: 'ollama', useNativeTools: true }), 'deepseek-r1:14b')).toBe(true);
	});
});
