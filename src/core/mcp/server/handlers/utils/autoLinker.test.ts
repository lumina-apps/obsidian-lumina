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

		it('should not use word boundaries for korean words', () => {
			const content = '사과나무와 풋사과 그리고 사과.';
			const terms = [
				{ originalTerm: '사과', path: 'Apple.md' }
			];
			const result = applyAutoLink(content, terms);
			// "사과" appears in "사과나무", "풋사과", "사과"
			// In Korean, we don't use strict boundaries so all might be matched.
			// Let's verify behavior based on current regex
			expect(result.linksAdded).toBe(3);
			expect(result.newContent).toBe('[[Apple.md|사과]]나무와 풋[[Apple.md|사과]] 그리고 [[Apple.md|사과]].');
		});
	});
});

import { processAutoLink } from './autoLinker';
import { App, TFile, Editor } from 'obsidian';
import { vi } from 'vitest';

describe('processAutoLink', () => {
	it('should process auto link using app vault', async () => {
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
		expect(mockApp.vault.read).toHaveBeenCalledWith(mockFile);
		expect(mockApp.vault.modify).toHaveBeenCalledWith(mockFile, 'I want to link to [[Other Note|other note]] here.');
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
		expect(result.message).toBe('추가할 링크가 없습니다.');
		expect(mockApp.vault.modify).not.toHaveBeenCalled();
	});

	it('should catch and return error on failure', async () => {
		// Suppress expected console.error in test output
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
		expect(result.message).toContain('오류 발생');

		consoleSpy.mockRestore();
	});
});

