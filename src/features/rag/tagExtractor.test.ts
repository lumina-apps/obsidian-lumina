import { describe, it, expect } from 'vitest';
import { extractBodyTags, collectRecommendedTags } from './tagExtractor';
import type { SearchResult } from '../../shared/types/rag.types';

describe('tagExtractor', () => {
	it('extractBodyTags should extract hashtag patterns from search results', () => {
		const results: SearchResult[] = [
			{
				chunk: { id: 'c1', path: 'note1.md', text: 'This note is about #ai and #rag', chunkIndex: 0 },
				score: 0.8,
			},
			{
				chunk: { id: 'c2', path: 'note2.md', text: 'Another note mentioning #rag and #nlp', chunkIndex: 0 },
				score: 0.6,
			},
		];

		const tags = extractBodyTags(results);
		expect(tags.map(t => t.tag)).toContain('#rag');
		expect(tags.map(t => t.tag)).toContain('#ai');
		expect(tags.map(t => t.tag)).toContain('#nlp');

		// #rag appeared in both, so its score should be highest
		expect(tags[0].tag).toBe('#rag');
	});

	it('extractBodyTags should support Japanese, Chinese and Hangul hashtags', () => {
		const results: SearchResult[] = [
			{
				chunk: { id: 'c1', path: 'note1.md', text: 'CJK tags: #設定 #プロジェクト #인공지능 #人工智能', chunkIndex: 0 },
				score: 0.9,
				rawVectorScore: 0.9,
			},
		];

		const tags = extractBodyTags(results);
		expect(tags.map(t => t.tag)).toContain('#設定');
		expect(tags.map(t => t.tag)).toContain('#プロジェクト');
		expect(tags.map(t => t.tag)).toContain('#인공지능');
		expect(tags.map(t => t.tag)).toContain('#人工智能');
		expect(tags[0].score).toBeCloseTo(0.9);
	});

	it('collectRecommendedTags should EXCLUDE tags already on the active note', () => {
		const results: SearchResult[] = [
			{
				chunk: { id: 'c1', path: 'other.md', text: 'Contains #ai and #recommended', chunkIndex: 0 },
				score: 0.8,
			},
		];

		const metadataCache = {
			getCache: (path: string) => {
				if (path === 'active.md') {
					return {
						frontmatter: { tags: ['ai', 'existing'] },
						tags: [{ tag: '#existing2' }],
					};
				}
				if (path === 'other.md') {
					return {
						frontmatter: { tags: ['novelTag'] },
						tags: [{ tag: '#novelTag2' }],
					};
				}
				return null;
			},
		};

		const tags = collectRecommendedTags({
			results,
			metadataCache,
			activeFilePath: 'active.md',
		});

		const recommendedTagNames = tags.map(t => t.tag.toLowerCase());

		// Must NOT contain active note's existing tags
		expect(recommendedTagNames).not.toContain('#ai');
		expect(recommendedTagNames).not.toContain('#existing');
		expect(recommendedTagNames).not.toContain('#existing2');

		// Must contain novel tags from other document
		expect(recommendedTagNames).toContain('#recommended');
		expect(recommendedTagNames).toContain('#noveltag');
		expect(recommendedTagNames).toContain('#noveltag2');

		// All scores must be <= 1.0
		for (const t of tags) {
			expect(t.score).toBeLessThanOrEqual(1.0);
		}
	});

	it('collectRecommendedTags should exclude the filename itself from path tags', () => {
		const results: SearchResult[] = [
			{
				chunk: { id: 'c1', path: 'projects/deep-learning/transformer-model.md', text: 'Some text', chunkIndex: 0 },
				score: 0.9,
			},
		];
		const metadataCache = {
			getCache: () => null,
		};

		const tags = collectRecommendedTags({
			results,
			metadataCache,
			activeFilePath: 'active.md',
		});

		const tagNames = tags.map(t => t.tag);
		expect(tagNames).toContain('#deep-learning');
		expect(tagNames).not.toContain('#transformer-model');
	});
});
