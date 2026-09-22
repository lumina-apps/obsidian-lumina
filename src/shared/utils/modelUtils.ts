/** LLM 모델 옵션 빌드, 파싱, 임베딩 판별 유틸리티 */

import { Notice } from 'obsidian';
import { PROVIDER_LABELS, PROVIDER_CATEGORIES, isCliProvider } from '../types/settings.types';
import type { LLMProviderConfig, ProviderType, FavoriteModel } from '../types/settings.types';
import { t } from '../locales/helpers';

export interface ModelOption {
	value: string;
	label: string;
}

export type ModelFilterFn = (providerType: ProviderType, modelId: string) => boolean;

export interface ParsedProviderModel {
	providerId: string;
	modelId: string;
}

export interface FlattenedModel {
	providerId: string;
	providerType: ProviderType;
	providerName: string;
	modelId: string;
	label: string;
	value: string;
	isFavorite?: boolean;
}

/** PROVIDER_LABELS에서 괄호 설명 제거 */
export function stripProviderSuffix(label: string): string {
	return label.replace(/\s*\(.*\)\s*/, '');
}

/** ProviderType의 짧은 표시명 반환 */
export function getShortProviderLabel(providerType: ProviderType): string {
	return stripProviderSuffix(PROVIDER_LABELS[providerType] || providerType);
}

/** 모델이 임베딩 전용인지 판별 */
export function isEmbeddingModel(providerType: ProviderType, modelId?: string): boolean {
	if (!modelId) {
		const category = PROVIDER_CATEGORIES[providerType];
		return category === 'local' || providerType === 'custom';
	}

	switch (providerType) {
		case 'anthropic':
		case 'xai':
		case 'groq':
			return false; // 임베딩 모델 없음
		default: {
			const lower = modelId.toLowerCase();
			return lower.includes('embed') || lower.includes('bge-') || lower.includes('gte-');
		}
	}
}

/** 검증된 프로바이더에서 모델 옵션 배열 생성 */
export function buildProviderModelOptions(
	providers: LLMProviderConfig[],
	filter: ModelFilterFn,
	localWarning: string = ' ⚠️',
): ModelOption[] {
	const options: ModelOption[] = [];
	const verified = providers.filter(p => p.isVerified && p.availableModels.length > 0);

	for (const p of verified) {
		const isLocal = PROVIDER_CATEGORIES[p.type] === 'local' || p.type === 'custom';
		for (const model of p.availableModels) {
			if (!filter(p.type, model)) continue;
			const label = isLocal
				? `[${PROVIDER_LABELS[p.type]}] ${model}${localWarning}`
				: `[${PROVIDER_LABELS[p.type]}] ${model}`;
			options.push({ value: `${p.id}::${model}`, label });
		}
	}

	return options;
}

/** 채팅용 모델 옵션 생성 (임베딩 모델 제외) */
export function buildChatModelOptions(providers: LLMProviderConfig[]): ModelOption[] {
	return buildProviderModelOptions(providers, (type, modelId) => {
		const isLocal = PROVIDER_CATEGORIES[type] === 'local' || type === 'custom';
		if (isLocal) return true;
		return !isEmbeddingModel(type, modelId);
	});
}

/** 임베딩용 모델 옵션 생성 (CLI 프로바이더 제외) */
export function buildEmbeddingModelOptions(providers: LLMProviderConfig[]): ModelOption[] {
	return buildProviderModelOptions(providers, (type, modelId) => {
		if (isCliProvider(type)) return false;
		if (PROVIDER_CATEGORIES[type] === 'local' || type === 'custom') return true;
		if (type === 'anthropic') return false;
		return isEmbeddingModel(type, modelId);
	});
}

/** 퀵액션, 태스크, 리랭커 등 보조 태스크용 경량 모델 옵션 생성 (CLI 에이전트 및 임베딩 모델 제외) */
export function buildDedicatedModelOptions(providers: LLMProviderConfig[]): ModelOption[] {
	return buildProviderModelOptions(providers, (type, modelId) => {
		if (isCliProvider(type)) return false;
		const isLocal = PROVIDER_CATEGORIES[type] === 'local' || type === 'custom';
		if (isLocal) return true;
		return !isEmbeddingModel(type, modelId);
	});
}

/** "providerId::modelId" 문자열 파싱 */
export function parseProviderModelValue(raw: string): ParsedProviderModel | null {
	const sepIdx = raw.indexOf('::');
	if (sepIdx === -1) return null;
	return {
		providerId: raw.slice(0, sepIdx),
		modelId: raw.slice(sepIdx + 2),
	};
}

/** providerId + modelId → "providerId::modelId" */
export function toProviderModelValue(providerId: string, modelId: string): string {
	return `${providerId}::${modelId}`;
}

/** 모델이 즐겨찾기에 포함되어 있는지 확인 */
export function isFavoriteModel(
	favoriteModels: FavoriteModel[] | undefined,
	providerId: string,
	modelId: string,
): boolean {
	if (!favoriteModels || favoriteModels.length === 0) return false;
	return favoriteModels.some(f => f.providerId === providerId && f.modelId === modelId);
}

/** 즐겨찾기 목록을 토글(추가/제거) 후 새 배열 반환 */
export function toggleFavoriteModel(
	favoriteModels: FavoriteModel[] | undefined,
	providerId: string,
	modelId: string,
): FavoriteModel[] {
	const list = favoriteModels ?? [];
	const exists = list.some(f => f.providerId === providerId && f.modelId === modelId);
	if (exists) {
		return list.filter(f => !(f.providerId === providerId && f.modelId === modelId));
	}
	return [...list, { providerId, modelId }];
}

/** 프로바이더 배열을 평탄화된 모델 목록으로 변환 */
export function flattenProviderModels(
	providers: LLMProviderConfig[],
	favoriteModels?: FavoriteModel[],
): FlattenedModel[] {
	return providers.flatMap((p) =>
		p.availableModels.map((m) => ({
			providerId: p.id,
			providerType: p.type,
			providerName: PROVIDER_LABELS[p.type] || p.type,
			modelId: m,
			label: m,
			value: `${p.id}::${m}`,
			isFavorite: isFavoriteModel(favoriteModels, p.id, m),
		})),
	);
}

/** 즐겨찾기 모델을 상단으로 정렬한 평탄화 모델 목록 반환 */
export function sortWithFavorites(models: FlattenedModel[]): FlattenedModel[] {
	return [...models].sort((a, b) => {
		const aFav = a.isFavorite ? 1 : 0;
		const bFav = b.isFavorite ? 1 : 0;
		return bFav - aFav;
	});
}

/** 즐겨찾기 모델을 상단으로 정렬하고 ★ 접두사를 붙인 ModelOption 목록 반환 (설정 탭 등에서 활용) */
export function sortModelOptionsWithFavorites(
	options: ModelOption[],
	favoriteModels?: FavoriteModel[],
): ModelOption[] {
	if (!favoriteModels || favoriteModels.length === 0) return options;
	const favSet = new Set(favoriteModels.map(f => `${f.providerId}::${f.modelId}`));
	return [...options]
		.sort((a, b) => {
			const aFav = favSet.has(a.value) ? 1 : 0;
			const bFav = favSet.has(b.value) ? 1 : 0;
			return bFav - aFav;
		})
		.map(opt => {
			if (favSet.has(opt.value) && !opt.label.startsWith('★ ')) {
				return { ...opt, label: `★ ${opt.label}` };
			}
			return opt;
		});
}

export const REASONING_MODEL_NOTICE_DURATION = 10000;

/** 추론형 모델 경고 */
export function warnIfReasoningModel(modelId?: string): void {
	if (!modelId) return;
	const lower = modelId.toLowerCase();
	if (/(?:^|[_\W/-])r1(?:$|[_\W/-])/.test(lower) || lower.includes('qwq') || lower.includes('reasoning') || lower.includes('thinking')) {
		new Notice(t('settings.connections.quickActionModel.reasoningWarning'), REASONING_MODEL_NOTICE_DURATION);
	}
}

/**
 * 알려진 모델명 패턴을 기반으로 물리적 컨텍스트 윈도우(토큰 한도)를 추정합니다.
 * 미확인 모델의 경우 안전 기본값 128,000을 반환합니다.
 */
export function getModelContextLimit(modelId?: string, providerType?: ProviderType): number {
	if (!modelId) return 128000;
	const lower = modelId.toLowerCase();

	// 1. Google Gemini (1M ~ 2M)
	if (lower.includes('gemini')) {
		if (lower.includes('1.5') || lower.includes('2.0') || lower.includes('2.5') || lower.includes('pro') || lower.includes('flash')) {
			return 1000000;
		}
		return 32768;
	}

	// 2. Anthropic Claude (200k)
	if (lower.includes('claude')) {
		if (lower.includes('3') || lower.includes('2.1')) {
			return 200000;
		}
		return 100000;
	}

	// 3. OpenAI GPT / Reasoning
	if (lower.includes('gpt-4o') || lower.includes('o1') || lower.includes('o3') || lower.includes('gpt-4-turbo')) {
		return 128000;
	}
	if (lower.includes('gpt-4-32k')) return 32768;
	if (lower.includes('gpt-4')) return 8192;
	if (lower.includes('gpt-3.5-turbo-16k')) return 16385;
	if (lower.includes('gpt-3.5')) return 16385;

	// 4. DeepSeek (64k ~ 128k)
	if (lower.includes('deepseek')) {
		return 64000;
	}

	// 5. Meta Llama
	if (lower.includes('llama-3.1') || lower.includes('llama-3.2') || lower.includes('llama-3.3') || lower.includes('llama3.1') || lower.includes('llama3.2') || lower.includes('llama3.3')) {
		return 128000;
	}
	if (lower.includes('llama-3') || lower.includes('llama3')) {
		return 8192;
	}

	// 6. Mistral / Qwen
	if (lower.includes('mistral-large') || lower.includes('codestral')) {
		return 128000;
	}
	if (lower.includes('qwen-2.5') || lower.includes('qwen2.5')) {
		return 128000;
	}
	if (lower.includes('qwen')) {
		return 32768;
	}

	// 7. Provider 카테고리가 로컬인 경우 (기본 32k)
	if (providerType && PROVIDER_CATEGORIES[providerType] === 'local') {
		return 32768;
	}

	// 8. 기본 fallback
	return 128000;
}

/**
 * 대화 기억 방식(memoryMethod)과 모델 스펙을 종합하여 유효 컨텍스트 한도를 반환합니다.
 * - memoryMethod === 'tokens' 인 경우: 사용자가 지정한 maxContextTokens 우선 적용.
 * - memoryMethod === 'turns' 또는 'auto_summary' 인 경우: 모델의 실제 물리적 컨텍스트 윈도우 적용.
 */
export function getEffectiveContextLimit(
	modelId?: string,
	chatSettings?: { memoryMethod?: 'auto_summary' | 'turns' | 'tokens'; maxContextTokens?: number },
	providerType?: ProviderType,
): number {
	if (chatSettings?.memoryMethod === 'tokens' && chatSettings.maxContextTokens) {
		return chatSettings.maxContextTokens;
	}
	return getModelContextLimit(modelId, providerType);
}
