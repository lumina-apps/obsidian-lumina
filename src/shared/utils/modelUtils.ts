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
	const category = PROVIDER_CATEGORIES[providerType];
	if (category === 'local' || providerType === 'custom') return true;
	if (!modelId) return false;

	switch (providerType) {
		case 'anthropic':
		case 'xai':
		case 'groq':
			return false; // 임베딩 모델 없음
		default:
			return modelId.toLowerCase().includes('embedding');
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
	if (lower.includes('r1') || lower.includes('qwq') || lower.includes('reasoning') || lower.includes('thinking')) {
		new Notice(t('settings.connections.quickActionModel.reasoningWarning'), REASONING_MODEL_NOTICE_DURATION);
	}
}
