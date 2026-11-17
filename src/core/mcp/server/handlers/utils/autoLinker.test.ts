import { describe, it, expect } from 'vitest';
import { applyAutoLink } from './autoLinker';

describe('applyAutoLink', () => {
	it('should replace matched terms with wikilinks', () => {
		const content = 'This is a test of auto linking Obsidian.';
		const terms = [
			{ originalTerm: 'Obsidian', path: 'Obsidian' }
		];
		const result = applyAutoLink(content, terms);
		expect(result.linksAdded).toBe(1);
		expect(result.newContent).toBe('This is a test of auto linking [[Obsidian]].');
	});

	it('should use aliases correctly', () => {
		const content = 'I love artificial intelligence!';
		const terms = [
			{ originalTerm: 'artificial intelligence', path: 'AI.md' }
		];
		const result = applyAutoLink(content, terms);
		expect(result.linksAdded).toBe(1);
		expect(result.newContent).toBe('I love [[AI.md|artificial intelligence]]!');
	});

	it('should prioritize longer terms over shorter terms', () => {
		// terms are expected to be pre-sorted by length descending!
		const content = 'I ate an apple pie today.';
		const terms = [
			{ originalTerm: 'apple pie', path: 'Apple Pie.md' },
			{ originalTerm: 'apple', path: 'Apple.md' }
		];
		const result = applyAutoLink(content, terms);
		expect(result.linksAdded).toBe(1);
		expect(result.newContent).toBe('I ate an [[Apple Pie.md|apple pie]] today.');
	});

	it('should ignore single character terms', () => {
		const content = 'A cat is an animal.';
		const terms = [
			{ originalTerm: 'A', path: 'Letter A.md' },
			{ originalTerm: 'cat', path: 'Cat.md' }
		];
		const result = applyAutoLink(content, terms);
		expect(result.linksAdded).toBe(1);
		expect(result.newContent).toBe('A [[Cat.md|cat]] is an animal.');
	});

	describe('protected regions', () => {
		it('should not replace inside existing wikilinks', () => {
			const content = 'Here is a link: [[Obsidian]]. It should not be replaced again.';
			const terms = [
				{ originalTerm: 'Obsidian', path: 'Obsidian.md' }
			];
			const result = applyAutoLink(content, terms);
			expect(result.linksAdded).toBe(0);
			expect(result.newContent).toBe(content);
		});

		it('should not replace inside markdown links', () => {
			const content = 'Here is a [link to Obsidian](https://obsidian.md).';
			const terms = [
				{ originalTerm: 'Obsidian', path: 'Obsidian.md' }
			];
			const result = applyAutoLink(content, terms);
			expect(result.linksAdded).toBe(0);
			expect(result.newContent).toBe(content);
		});

		it('should not replace inside inline code', () => {
			const content = 'Use the `Obsidian` API.';
			const terms = [
				{ originalTerm: 'Obsidian', path: 'Obsidian.md' }
			];
			const result = applyAutoLink(content, terms);
			expect(result.linksAdded).toBe(0);
			expect(result.newContent).toBe(content);
		});

		it('should not replace inside code blocks', () => {
			const content = '```\nObsidian is awesome\n```\nBut Obsidian outside is replaced.';
			const terms = [
				{ originalTerm: 'Obsidian', path: 'Obsidian.md' }
			];
			const result = applyAutoLink(content, terms);
			expect(result.linksAdded).toBe(1);
			expect(result.newContent).toBe('```\nObsidian is awesome\n```\nBut [[Obsidian.md|Obsidian]] outside is replaced.');
		});

		it('should not replace inside frontmatter', () => {
			const content = '---\ntitle: Obsidian notes\n---\nObsidian is great.';
			const terms = [
				{ originalTerm: 'Obsidian', path: 'Obsidian.md' }
			];
			const result = applyAutoLink(content, terms);
			expect(result.linksAdded).toBe(1);
			expect(result.newContent).toBe('---\ntitle: Obsidian notes\n---\n[[Obsidian.md|Obsidian]] is great.');
		});

		it('should not replace inside CRLF frontmatter', () => {
			const content = '---\r\ntitle: Obsidian notes\r\n---\r\nObsidian is great.';
			const terms = [
				{ originalTerm: 'Obsidian', path: 'Obsidian.md' }
			];
			const result = applyAutoLink(content, terms);
			expect(result.linksAdded).toBe(1);
			expect(result.newContent).toBe('---\r\ntitle: Obsidian notes\r\n---\r\n[[Obsidian.md|Obsidian]] is great.');
		});

		it('should not replace inside markdown headings', () => {
			const content = '# Welcome to Obsidian\nObsidian is great.';
			const terms = [
				{ originalTerm: 'Obsidian', path: 'Obsidian.md' }
			];
			const result = applyAutoLink(content, terms);
			expect(result.linksAdded).toBe(1);
			expect(result.newContent).toBe('# Welcome to Obsidian\n[[Obsidian.md|Obsidian]] is great.');
		});

		it('should not replace inside inline hashtags', () => {
			const content = 'Check out #Obsidian and Obsidian note.';
			const terms = [
				{ originalTerm: 'Obsidian', path: 'Obsidian.md' }
			];
			const result = applyAutoLink(content, terms);
			expect(result.linksAdded).toBe(1);
			expect(result.newContent).toBe('Check out #Obsidian and [[Obsidian.md|Obsidian]] note.');
		});

		it('should not replace raw URLs', () => {
			const content = 'Visit https://obsidian.md/test for more info.';
			const terms = [
				{ originalTerm: 'obsidian', path: 'Obsidian.md' }
			];
			const result = applyAutoLink(content, terms);
			expect(result.linksAdded).toBe(0);
			expect(result.newContent).toBe(content);
		});
	});

	describe('word boundaries vs exact match', () => {
		it('should use word boundaries for pure english words', () => {
			const content = 'pineapple and apple.';
			const terms = [
				{ originalTerm: 'apple', path: 'Apple.md' }
			];
			const result = applyAutoLink(content, terms);
			expect(result.linksAdded).toBe(1);
			// pineapple should NOT be matched.
			expect(result.newContent).toBe('pineapple and [[Apple.md|apple]].');
		});

		it('한국어 복합어는 훼손하지 않고 어절 경계 및 조사 결합 형태만 링크한다', () => {
			const content = '사과나무와 풋사과 그리고 사과를 먹었다.';
			const terms = [
				{ originalTerm: '사과', path: 'Apple.md' }
			];
			const result = applyAutoLink(content, terms);
			// "사과나무", "풋사과"는 복합어이므로 제외되고 "사과를"의 "사과"만 1회 매칭됨
			expect(result.linksAdded).toBe(1);
			expect(result.newContent).toBe('사과나무와 풋사과 그리고 [[Apple.md|사과]]를 먹었다.');
		});

		it('1노트 1링크 원칙: 본문 내 동일 대상이 여러 번 등장하거나 이미 링크가 있으면 중복 링크하지 않는다', () => {
			const repeated = 'Obsidian is great. I use Obsidian every day.';
			const terms = [{ originalTerm: 'Obsidian', path: 'Obsidian' }];
			const res1 = applyAutoLink(repeated, terms);
			expect(res1.linksAdded).toBe(1);
			expect(res1.newContent).toBe('[[Obsidian]] is great. I use Obsidian every day.');

			const alreadyLinked = 'See [[Obsidian]] for details. Obsidian is useful.';
			const res2 = applyAutoLink(alreadyLinked, terms);
			expect(res2.linksAdded).toBe(0);
			expect(res2.newContent).toBe(alreadyLinked);
		});
	});
});

import { processAutoLink } from './autoLinker';
import { App, TFile, Editor } from 'obsidian';
import { vi, beforeEach } from 'vitest';
import { approvalManager } from '../../../../store/approvalStore';

vi.mock('../../../../store/approvalStore', () => ({
	approvalManager: {
		requestApproval: vi.fn(),
	},
}));

describe('processAutoLink', () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.mocked(approvalManager.requestApproval).mockImplementation(async (_path, _base, proposed) => ({
			approved: true,
			content: proposed,
		}));
	});

	it('should process auto link using app vault after inline diff approval', async () => {
		const mockFile = { path: 'test.md', basename: 'test', extension: 'md' } as TFile;
		const otherFile = { path: 'other.md', basename: 'Other Note', extension: 'md' } as TFile;
		
		const mockApp = {
			vault: {
				read: vi.fn().mockResolvedValue('I want to link to other note here.'),
				modify: vi.fn().mockResolvedValue(undefined),
				getMarkdownFiles: vi.fn().mockReturnValue([mockFile, otherFile])
			},
			metadataCache: {
				getFileCache: vi.fn().mockReturnValue(null)
			}
		} as unknown as App;

		const result = await processAutoLink(mockApp, mockFile);

		expect(result.success).toBe(true);
		expect(result.linksAdded).toBe(1);
		expect(approvalManager.requestApproval).toHaveBeenCalledWith(
			'test.md',
			'I want to link to other note here.',
			'I want to link to [[Other Note|other note]] here.',
			expect.any(Object),
		);
		expect(mockApp.vault.read).toHaveBeenCalledWith(mockFile);
		expect(mockApp.vault.modify).toHaveBeenCalledWith(mockFile, 'I want to link to [[Other Note|other note]] here.');
	});

	it('should not modify editor or file when inline diff approval is rejected', async () => {
		vi.mocked(approvalManager.requestApproval).mockResolvedValueOnce({
			approved: false,
			content: '',
		});

		const mockFile = { path: 'test.md', basename: 'test', extension: 'md' } as TFile;
		const otherFile = { path: 'other.md', basename: 'Other Note', extension: 'md' } as TFile;

		const mockApp = {
			vault: {
				getMarkdownFiles: vi.fn().mockReturnValue([mockFile, otherFile])
			},
			metadataCache: {
				getFileCache: vi.fn().mockReturnValue(null)
			}
		} as unknown as App;

		const mockEditor = {
			getValue: vi.fn().mockReturnValue('I want to link to other note here.'),
			setValue: vi.fn(),
			getCursor: vi.fn().mockReturnValue({ line: 0, ch: 0 }),
			setCursor: vi.fn()
		} as unknown as Editor;

		const result = await processAutoLink(mockApp, mockFile, mockEditor);

		expect(result.success).toBe(true);
		expect(result.linksAdded).toBe(0);
		expect(mockEditor.setValue).not.toHaveBeenCalled();
	});

	it('should process auto link using editor if provided', async () => {
		const mockFile = { path: 'test.md', basename: 'test', extension: 'md' } as TFile;
		const otherFile = { path: 'alias.md', basename: 'Alias Note', extension: 'md' } as TFile;
		
		const mockApp = {
			vault: {
				getMarkdownFiles: vi.fn().mockReturnValue([mockFile, otherFile])
			},
			metadataCache: {
				getFileCache: vi.fn().mockImplementation((f: TFile) => {
					if (f.path === 'alias.md') {
						return { frontmatter: { aliases: ['custom alias'] } };
					}
					return null;
				})
			}
		} as unknown as App;

		const mockEditor = {
			getValue: vi.fn().mockReturnValue('Testing custom alias linking.'),
			setValue: vi.fn(),
			getCursor: vi.fn().mockReturnValue({ line: 0, ch: 0 }),
			setCursor: vi.fn()
		} as unknown as Editor;

		const result = await processAutoLink(mockApp, mockFile, mockEditor);

		expect(result.success).toBe(true);
		expect(result.linksAdded).toBe(1);
		expect(mockEditor.getValue).toHaveBeenCalled();
		expect(mockEditor.setValue).toHaveBeenCalledWith('Testing [[Alias Note|custom alias]] linking.');
		expect(mockEditor.getCursor).toHaveBeenCalled();
		expect(mockEditor.setCursor).toHaveBeenCalled();
	});

	it('should return 0 links added if no matches found', async () => {
		const mockFile = { path: 'test.md', basename: 'test', extension: 'md' } as TFile;
		
		const mockApp = {
			vault: {
				read: vi.fn().mockResolvedValue('Nothing to link.'),
				modify: vi.fn(),
				getMarkdownFiles: vi.fn().mockReturnValue([mockFile])
			},
			metadataCache: {
				getFileCache: vi.fn().mockReturnValue(null)
			}
		} as unknown as App;

		const result = await processAutoLink(mockApp, mockFile);

		expect(result.success).toBe(true);
		expect(result.linksAdded).toBe(0);
		expect(result.message).toBe('No unlinked mentions found to link.');
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
	});

	it('should catch and return error on failure', async () => {
		const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

		const mockFile = { path: 'test.md', basename: 'test', extension: 'md' } as TFile;
		
		const mockApp = {
			vault: {
				read: vi.fn().mockRejectedValue(new Error('Vault read error')),
			}
		} as unknown as App;

		const result = await processAutoLink(mockApp, mockFile);

		expect(result.success).toBe(false);
		expect(result.linksAdded).toBe(0);
		expect(result.message).toContain('Vault read error');

		consoleSpy.mockRestore();
	});
});

