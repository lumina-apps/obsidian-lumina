import {
	isCliProvider,
	type FavoriteModel,
	type LLMProviderConfig,
} from '../../../shared/types/settings.types';
import type {
	SplitChatPreferences,
	SplitSlotConfig,
} from '../../../shared/types/splitChat.types';
import {
	flattenProviderModels,
	isEmbeddingModel,
	sortWithFavorites,
} from '../../../shared/utils/modelUtils';

const SLOT_LABELS = ['A', 'B', 'C', 'D'] as const;

const SLOT_COLORS: Record<string, string> = {
	A: '#8b5cf6',
	B: '#0ea5e9',
	C: '#10b981',
	D: '#f59e0b',
};

/** 슬롯 레이블(A~D)에 대응하는 시각적 구분 색상 반환 */
export function getSlotAccentColor(label: string): string {
	return SLOT_COLORS[label] ?? 'var(--interactive-accent)';
}

/** Split 모드에서 사용 가능한 비-CLI 검증 완료 프로바이더 필터링 (임베딩 모델 제외) */
export function getSplitEligibleProviders(
	providers: readonly LLMProviderConfig[],
): LLMProviderConfig[] {
	return providers
		.filter((p) => !isCliProvider(p.type) && p.isVerified && p.availableModels.length > 0)
		.map((p) => {
			const chatModels = p.availableModels.filter((m) => !isEmbeddingModel(p.type, m));
			return {
				...p,
				availableModels: chatModels.length > 0 ? chatModels : p.availableModels,
			};
		});
}

/** 초기 슬롯 2~4개 조합 결정 (저장된 선호 조합 우선, 없으면 즐겨찾기 기준 서로 다른 2개 자동 선택) */
export function pickInitialSplitSlots(
	providers: readonly LLMProviderConfig[],
	favoriteModels: FavoriteModel[] = [],
	savedPrefs?: SplitChatPreferences,
): SplitSlotConfig[] {
	const eligible = getSplitEligibleProviders(providers);
	if (eligible.length === 0) return [];

	const allModels = sortWithFavorites(flattenProviderModels(eligible, favoriteModels));
	if (allModels.length === 0) return [];

	if (savedPrefs?.lastSlots && savedPrefs.lastSlots.length >= 2) {
		const validSaved = savedPrefs.lastSlots
			.slice(0, 4)
			.filter((saved) =>
				eligible.some(
					(p) =>
						p.id === saved.providerId && p.availableModels.includes(saved.modelId),
				),
			);

		if (validSaved.length >= 2) {
			return validSaved.map((saved, idx) => ({
				slotId: crypto.randomUUID(),
				label: SLOT_LABELS[idx] ?? String(idx + 1),
				providerId: saved.providerId,
				modelId: saved.modelId,
				...(saved.temperatureOverride !== undefined
					? { temperatureOverride: saved.temperatureOverride }
					: {}),
			}));
		}
	}

	const first = allModels[0];
	// 서로 다른 프로바이더 모델을 우선 선택하고, 단일 프로바이더면 같은 프로바이더 내 다른 모델을 선택
	const second =
		allModels.find((m) => m.providerId !== first.providerId) ??
		allModels.find(
			(m) => !(m.providerId === first.providerId && m.modelId === first.modelId),
		) ??
		first;

	return [
		{
			slotId: crypto.randomUUID(),
			label: 'A',
			providerId: first.providerId,
			modelId: first.modelId,
		},
		{
			slotId: crypto.randomUUID(),
			label: 'B',
			providerId: second.providerId,
			modelId: second.modelId,
		},
	];
}

/** "+ 모델 추가" 클릭 시 기존 슬롯과 겹치지 않는 다음 추천 모델 슬롯 생성 */
export function createNextSplitSlot(
	currentSlots: readonly SplitSlotConfig[],
	providers: readonly LLMProviderConfig[],
	favoriteModels: FavoriteModel[] = [],
): SplitSlotConfig | null {
	const eligible = getSplitEligibleProviders(providers);
	const allModels = sortWithFavorites(flattenProviderModels(eligible, favoriteModels));
	if (allModels.length === 0) return null;

	const usedKeys = new Set(currentSlots.map((s) => `${s.providerId}::${s.modelId}`));
	const candidate =
		allModels.find((m) => !usedKeys.has(`${m.providerId}::${m.modelId}`)) ??
		allModels[0];

	return {
		slotId: crypto.randomUUID(),
		label: SLOT_LABELS[currentSlots.length] ?? String(currentSlots.length + 1),
		providerId: candidate.providerId,
		modelId: candidate.modelId,
	};
}
