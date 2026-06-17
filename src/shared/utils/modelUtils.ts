/**
 * modelUtils.ts
 *
 * LLM 모델 옵션 빌드, 파싱, 임베딩 판별을 위한 유틸리티 모음.
 * - 모델 옵션 빌더 (buildProviderModelOptions, buildChatModelOptions, buildEmbeddingModelOptions)
 * - 프로바이더-모델 값 파싱 (parseProviderModelValue, toProviderModelValue)
 * - 임베딩 모델 판별기 (isEmbeddingModel)
 */

import { PROVIDER_LABELS, PROVIDER_CATEGORIES } from '../types/settings.types';
import type { LLMProviderConfig, ProviderType } from '../types/settings.types';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ModelOption {
	value: string;
	label: string;
}

export type ModelFilterFn = (providerType: ProviderType, modelId: string) => boolean;

export interface ParsedProviderModel {
	providerId: string;
	modelId: string;
}

// ─── Embedding Model Detector ─────────────────────────────────────────────────

/**
 * 프로바이더 타입별로 임베딩 전용 모델인지 판별합니다.
 * 클라우드 프로바이더는 모델명 패턴으로 필터링.
 * 로컬/커스텀은 판별 불가 → 전체 허용 + ⚠️ 표시.
 */
export function isEmbeddingModel(providerType: ProviderType, modelId: string): boolean {
	const category = PROVIDER_CATEGORIES[providerType];
	if (category === 'local' || providerType === 'custom') return true;

	switch (providerType) {
		case 'anthropic':
		case 'xai':
		case 'groq':
			return false; // 임베딩 모델 없음
		default:
			return modelId.toLowerCase().includes('embedding');
	}
}

// ─── Model Option Builders ────────────────────────────────────────────────────

/**
 * 검증된 프로바이더 목록에서 모델 옵션 배열을 생성합니다.
 *
 * @param providers - 전체 프로바이더 설정 배열
 * @param filter - 모델 포함 여부를 결정하는 필터 함수.
 *                 (providerType, modelId) => boolean.
 *                 true를 반환한 모델만 옵션에 포함.
 * @param localWarning - 로컬/커스텀 프로바이더의 모델에 붙일 경고 접미사 (기본 ' ⚠️')
 * @returns ModelOption 배열. 값은 `${providerId}::${modelId}` 형태.
 */
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

/**
 * 채팅용 모델 옵션을 생성합니다 (임베딩 모델 제외).
 * buildProviderModelOptions의 채팅 특화 래퍼입니다.
 */
export function buildChatModelOptions(providers: LLMProviderConfig[]): ModelOption[] {
	return buildProviderModelOptions(providers, (type, modelId) => {
		const isLocal = PROVIDER_CATEGORIES[type] === 'local' || type === 'custom';
		if (isLocal) return true;
		return !isEmbeddingModel(type, modelId);
	});
}

/**
 * 임베딩용 모델 옵션을 생성합니다.
 * 클라우드는 isEmbeddingModel()로 필터링, 로컬은 전체 허용.
 * anthropic은 임베딩 모델을 제공하지 않으므로 자동 제외.
 */
export function buildEmbeddingModelOptions(providers: LLMProviderConfig[]): ModelOption[] {
	return buildProviderModelOptions(providers, (type, modelId) => {
		if (PROVIDER_CATEGORIES[type] === 'local' || type === 'custom') return true;
		if (type === 'anthropic') return false;
		return isEmbeddingModel(type, modelId);
	});
}

// ─── Value Parser ─────────────────────────────────────────────────────────────

/**
 * "providerId::modelId" 형식의 문자열을 파싱합니다.
 *
 * @param raw - "pid::modelId" 형식의 문자열
 * @returns { providerId, modelId } 또는 null (형식이 올바르지 않을 경우)
 */
export function parseProviderModelValue(raw: string): ParsedProviderModel | null {
	const sepIdx = raw.indexOf('::');
	if (sepIdx === -1) return null;
	return {
		providerId: raw.slice(0, sepIdx),
		modelId: raw.slice(sepIdx + 2),
	};
}

/**
 * providerId와 modelId를 "::" 구분자로 결합합니다.
 */
export function toProviderModelValue(providerId: string, modelId: string): string {
	return `${providerId}::${modelId}`;
}