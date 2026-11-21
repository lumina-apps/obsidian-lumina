import { describe, it, expect } from 'vitest';
import { formatSplitComparisonMarkdown } from './splitExportFormatter';
import type { SplitChatSession } from '../../../shared/types/splitChat.types';

function createSampleSession(overrides?: Partial<SplitChatSession>): SplitChatSession {
	return {
		id: 'split-1',
		sessionType: 'split',
		title: '모델 비교 테스트',
		mode: 'side-by-side',
		contextMode: 'independent',
		createdAt: 1700000000000,
		updatedAt: 1700000005000,
		slots: [
			{ slotId: 's1', label: 'A', providerId: 'anthropic', modelId: 'claude-sonnet' },
			{ slotId: 's2', label: 'B', providerId: 'openai', modelId: 'gpt-4o' },
		],
		turns: [
			{
				id: 't1',
				userMessage: {
					id: 'u1',
					role: 'user',
					content: '타입스크립트 장점을 요약해줘',
					isStreaming: false,
					timestamp: 1700000000000,
					attachments: [{ type: 'file', path: 'notes/ts.md', name: 'ts.md' }],
				},
				ragStep: null,
				ragSources: [{ filePath: 'notes/ref.md' }],
				winnerSlotId: 's1',
				isRevealed: true,
				responses: {
					s1: {
						slotId: 's1',
						providerId: 'anthropic',
						modelId: 'claude-sonnet',
						status: 'done',
						content: '<think>고민중</think>정적 타입 안전성을 제공합니다.',
						tokenUsage: { inputTokens: 100, outputTokens: 50, totalTokens: 150 },
						metrics: {
							startedAt: 1000,
							finishedAt: 2200,
							durationMs: 1200,
							ttftMs: 300,
							tokensPerSecond: 41.7,
						},
					},
					s2: {
						slotId: 's2',
						providerId: 'openai',
						modelId: 'gpt-4o',
						status: 'error',
						content: '',
						errorMessage: 'Rate limit exceeded',
						metrics: { startedAt: 1000, finishedAt: 1500, durationMs: 500 },
					},
				},
			},
		],
		...overrides,
	};
}

describe('splitExportFormatter', () => {
	it('비교 세션의 요약 테이블, 메트릭, 승자, 에러 상태를 마크다운으로 포맷한다', () => {
		const md = formatSplitComparisonMarkdown(createSampleSession());

		expect(md).toContain('# 모델 비교 테스트');
		expect(md).toContain('| A | claude-sonnet | 1 | 1.20s | 150 |');
		expect(md).toContain('| B | gpt-4o | 0 | 0.50s | - |');
		expect(md).toContain('타입스크립트 장점을 요약해줘');
		expect(md).toContain('[[notes/ts.md|ts.md]]');
		expect(md).toContain('[[notes/ref.md]]');
		expect(md).toContain('#### A · claude-sonnet 🏆');
		expect(md).toContain('정적 타입 안전성을 제공합니다.');
		expect(md).not.toContain('<think>고민중</think>');
		expect(md).toContain('Rate limit exceeded');
	});

	it('Blind 미공개 상태에서는 모델명을 숨기고 includeHiddenModels 옵션 시 공개한다', () => {
		const base = createSampleSession({ mode: 'blind' });
		base.turns[0].isRevealed = false;
		base.turns[0].winnerSlotId = null;

		const hiddenMd = formatSplitComparisonMarkdown(base);
		expect(hiddenMd).not.toContain('claude-sonnet');
		expect(hiddenMd).not.toContain('gpt-4o');

		const revealedMd = formatSplitComparisonMarkdown(base, { includeHiddenModels: true });
		expect(revealedMd).toContain('claude-sonnet');
		expect(revealedMd).toContain('gpt-4o');
	});
});
