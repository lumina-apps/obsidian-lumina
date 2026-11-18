import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile } from 'obsidian';
import {
	FrontmatterManager,
	sanitizeGeneratedFrontmatterData,
} from './frontmatterManager';
import { createProvider } from '../../core/llm-providers';
import type LuminaPlugin from '../../main';

vi.mock('../../core/llm-providers', () => ({
	createProvider: vi.fn(),
}));

describe('sanitizeGeneratedFrontmatterData', () => {
	it('tag1, tag2 같은 플레이스홀더 태그와 템플릿 설명을 제거한다', () => {
		const res = sanitizeGeneratedFrontmatterData({
			tags: ['tag1', 'tag2', '태그1', 'example', '<topic>'],
			description: "One-sentence summary of the document's core content",
		});

		expect(res).toBeNull();
	});

	it('유효한 태그의 선행 # 제거, 중복 제거, 최대 3개 제한을 적용한다', () => {
		const res = sanitizeGeneratedFrontmatterData({
			tags: ['#사과', '사과', 'tag1', ' 과수원 ', '품종', '여분태그'],
			description: '  사과와 과수원에 대한 짧은 메모입니다.  ',
		});

		expect(res).toEqual({
			tags: ['사과', '과수원', '품종'],
			description: '사과와 과수원에 대한 짧은 메모입니다.',
		});
	});

	it('태그가 모두 플레이스홀더여도 요약문이 유효하면 요약문만 보존한다', () => {
		const res = sanitizeGeneratedFrontmatterData({
			tags: ['tag1', 'tag2'],
			description: '사과를 먹은 일상을 기록한 짧은 노트입니다.',
		});

		expect(res).toEqual({
			tags: [],
			description: '사과를 먹은 일상을 기록한 짧은 노트입니다.',
		});
	});
});

describe('FrontmatterManager', () => {
	let mockApp: {
		vault: { read: ReturnType<typeof vi.fn> };
		metadataCache: { getFileCache: ReturnType<typeof vi.fn> };
		fileManager: { processFrontMatter: ReturnType<typeof vi.fn> };
	};
	let mockPlugin: LuminaPlugin;

	beforeEach(() => {
		vi.clearAllMocks();
		mockApp = {
			vault: {
				read: vi.fn().mockResolvedValue('오늘은 맛있는 사과를 먹었다. 마당에 사과나무도 있고 풋사과도 참 많다. 사과가 달콤하다.'),
			},
			metadataCache: {
				getFileCache: vi.fn().mockReturnValue({ frontmatter: { title: '사과' } }),
			},
			fileManager: {
				processFrontMatter: vi.fn().mockImplementation(async (_f: TFile, cb: (fm: Record<string, unknown>) => void) => {
					const fm: Record<string, unknown> = { title: '사과' };
					cb(fm);
					return fm;
				}),
			},
		};
		mockPlugin = {
			app: mockApp,
			settings: {
				misc: { autoFrontmatter: true },
				connections: {
					taskProviderId: 'google',
					taskModelId: 'gemini-2.5-flash',
					providers: [{ id: 'google', type: 'google', isVerified: true, availableModels: ['gemini-2.5-flash'] }],
				},
			},
		} as unknown as LuminaPlugin;
	});

	it('LLM이 tag1/tag2만 반환하면 tags를 기록하지 않고 유효한 description만 반영하며 lumina* 필드를 남기지 않는다', async () => {
		const writtenFm: Record<string, unknown> = { title: '사과' };
		mockApp.fileManager.processFrontMatter.mockImplementation(async (_f: TFile, cb: (fm: Record<string, unknown>) => void) => {
			cb(writtenFm);
		});
		vi.mocked(createProvider).mockReturnValue({
			chat: vi.fn().mockResolvedValue({
				content: '{"tags": ["tag1", "tag2"], "description": "사과에 관한 짧은 노트입니다."}',
			}),
		} as unknown as ReturnType<typeof createProvider>);

		const manager = new FrontmatterManager(mockPlugin);
		const file = Object.assign(new TFile(), { path: '사과.md', basename: '사과', extension: 'md' });
		await (manager as unknown as { generateFrontmatterData(f: TFile): Promise<void> }).generateFrontmatterData(file);

		expect(mockApp.fileManager.processFrontMatter).toHaveBeenCalledTimes(1);
		expect(writtenFm.tags).toBeUndefined();
		expect(writtenFm.description).toBe('사과에 관한 짧은 노트입니다.');
		expect(writtenFm.luminaCreated).toBeUndefined();
		expect(writtenFm.luminaModified).toBeUndefined();
		expect(writtenFm.luminaVersion).toBeUndefined();
	});

	it('LLM 프롬프트에 tag1/tag2 플레이스홀더 예시 대신 명시적 금지 규칙이 포함된다', async () => {
		const chatSpy = vi.fn().mockResolvedValue({
			content: '{"tags": ["과일", "사과"], "description": "사과를 다룬 노트입니다."}',
		});
		vi.mocked(createProvider).mockReturnValue({ chat: chatSpy } as unknown as ReturnType<typeof createProvider>);

		const manager = new FrontmatterManager(mockPlugin);
		const file = Object.assign(new TFile(), { path: '사과.md', basename: '사과', extension: 'md' });
		await (manager as unknown as { generateFrontmatterData(f: TFile): Promise<void> }).generateFrontmatterData(file);

		const promptArg = (chatSpy.mock.calls[0][0] as Array<{ content: string }>)[0].content;
		expect(promptArg).toContain('NEVER copy placeholder strings');
		expect(promptArg).not.toContain('["tag1", "tag2"]');
	});

	it('Windows CRLF 프론트매터를 제거한 본문만 LLM에 전달한다', async () => {
		const crlfNote =
			'---\r\ntitle: 사과\r\nsecret_meta: should_not_appear\r\n---\r\n오늘은 맛있는 사과를 먹었다. 마당에 사과나무도 있고 풋사과도 참 많다. 사과가 달콤하다.';
		mockApp.vault.read.mockResolvedValue(crlfNote);

		const chatSpy = vi.fn().mockResolvedValue({
			content: '{"tags": ["사과"], "description": "사과에 대한 짧은 메모입니다."}',
		});
		vi.mocked(createProvider).mockReturnValue({ chat: chatSpy } as unknown as ReturnType<typeof createProvider>);

		const manager = new FrontmatterManager(mockPlugin);
		const file = Object.assign(new TFile(), { path: '사과.md', basename: '사과', extension: 'md' });
		await (manager as unknown as { generateFrontmatterData(f: TFile): Promise<void> }).generateFrontmatterData(file);

		expect(chatSpy).toHaveBeenCalledTimes(1);
		const promptArg = (chatSpy.mock.calls[0][0] as Array<{ content: string }>)[0].content;
		expect(promptArg).not.toContain('secret_meta: should_not_appear');
		expect(promptArg).not.toContain('---\r\n');
		expect(promptArg).toContain('오늘은 맛있는 사과를 먹었다.');
	});

	it('maxOutputTokens 1000으로 요청하며 <think> 블록 안의 중괄호를 제거하고 JSON만 파싱한다', async () => {
		const writtenFm: Record<string, unknown> = {};
		mockApp.fileManager.processFrontMatter.mockImplementation(async (_f: TFile, cb: (fm: Record<string, unknown>) => void) => {
			cb(writtenFm);
		});

		const chatSpy = vi.fn().mockResolvedValue({
			content: '<think>스키마 예시 {invalid: json} 확인 완료</think>\n```json\n{"tags": ["과수원", "사과"], "description": "사과 메모입니다."}\n```',
		});
		vi.mocked(createProvider).mockReturnValue({ chat: chatSpy } as unknown as ReturnType<typeof createProvider>);

		const manager = new FrontmatterManager(mockPlugin);
		const file = Object.assign(new TFile(), { path: '사과.md', basename: '사과', extension: 'md' });
		await (manager as unknown as { generateFrontmatterData(f: TFile): Promise<void> }).generateFrontmatterData(file);

		expect(chatSpy).toHaveBeenCalledWith(
			expect.any(Array),
			expect.objectContaining({ maxOutputTokens: 1000 }),
		);
		expect(writtenFm.tags).toEqual(['과수원', '사과']);
		expect(writtenFm.description).toBe('사과 메모입니다.');
	});
});
