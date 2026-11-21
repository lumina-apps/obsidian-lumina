import { describe, it, expect } from 'vitest';
import type { LLMProviderConfig } from '../../../shared/types/settings.types';
import {
	createNextSplitSlot,
	getSplitEligibleProviders,
	pickInitialSplitSlots,
} from './splitSlotUtils';

const providers: LLMProviderConfig[] = [
	{
		id: 'cli-1',
		type: 'cli-claude-code',
		credential: '',
		availableModels: ['claude-code'],
		isVerified: true,
	},
	{
		id: 'unverified',
		type: 'openai',
		credential: '',
		availableModels: ['gpt-4o'],
		isVerified: false,
	},
	{
		id: 'p-openai',
		type: 'openai',
		credential: 'sk-1',
		availableModels: ['text-embedding-3-small', 'gpt-4o', 'gpt-4.1'],
		isVerified: true,
	},
	{
		id: 'p-anthropic',
		type: 'anthropic',
		credential: 'sk-2',
		availableModels: ['claude-sonnet'],
		isVerified: true,
	},
];

describe('splitSlotUtils', () => {
	it('CLI·미인증 프로바이더 및 임베딩 전용 모델을 제외한다', () => {
		const eligible = getSplitEligibleProviders(providers);
		expect(eligible.map((p) => p.id)).toEqual(['p-openai', 'p-anthropic']);
		expect(eligible[0].availableModels).toEqual(['gpt-4o', 'gpt-4.1']);
	});

	it('즐겨찾기 모델을 우선해 서로 다른 2개 초기 슬롯을 구성한다', () => {
		const slots = pickInitialSplitSlots(providers, [
			{ providerId: 'p-anthropic', modelId: 'claude-sonnet' },
		]);
		expect(slots).toHaveLength(2);
		expect(slots[0].label).toBe('A');
		expect(slots[0].modelId).toBe('claude-sonnet');
		expect(slots[1].label).toBe('B');
		expect(slots[1].modelId).toBe('gpt-4o');
	});

	it('사용 가능한 모델이 1개뿐이어도 동일 모델 2개 슬롯을 구성한다', () => {
		const singleProvider: LLMProviderConfig[] = [
			{
				id: 'only-one',
				type: 'openai',
				credential: 'sk',
				availableModels: ['gpt-4o'],
				isVerified: true,
			},
		];
		const slots = pickInitialSplitSlots(singleProvider);
		expect(slots).toHaveLength(2);
		expect(slots[0].modelId).toBe('gpt-4o');
		expect(slots[1].modelId).toBe('gpt-4o');
	});

	it('유효한 savedPrefs.lastSlots가 있으면 우선 복원하고 온도 설정을 유지한다', () => {
		const slots = pickInitialSplitSlots(providers, [], {
			lastSlots: [
				{ providerId: 'p-openai', modelId: 'gpt-4.1', temperatureOverride: 0.3 },
				{ providerId: 'p-anthropic', modelId: 'claude-sonnet' },
			],
		});
		expect(slots).toHaveLength(2);
		expect(slots[0].modelId).toBe('gpt-4.1');
		expect(slots[0].temperatureOverride).toBe(0.3);
		expect(slots[1].modelId).toBe('claude-sonnet');
	});

	it('createNextSplitSlot은 기존 슬롯에 없는 다음 모델을 우선 선택한다', () => {
		const initial = pickInitialSplitSlots(providers);
		const next = createNextSplitSlot(initial, providers);
		expect(next).not.toBeNull();
		expect(next?.label).toBe('C');
		expect(next?.modelId).toBe('gpt-4.1');
	});
});
