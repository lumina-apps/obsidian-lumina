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

/**
 * ModelSelector 등에서 사용하는 평탄화된 모델 항목.
 * 프로바이더 정보와 개별 모델 정보를 결합한 형태입니다.
 */
export interface FlattenedModel {
	providerId: string;
	providerType: ProviderType;
	providerName: string;
	modelId: string;
	label: string;
	value: string;
}

// ─── Provider Label Helpers ────────────────────────────────────────────────────

/**
 * PROVIDER_LABELS에서 괄호 안 부가 설명을 제거한 짧은 표시명을 반환합니다.
 * 예: "OpenAI (GPT)" → "OpenAI", "Anthropic (Claude)" → "Anthropic"
 */
export function stripProviderSuffix(label: string): string {
	return label.replace(/\s*\(.*\)\s*/, '');
}

/**
 * ProviderType에 해당하는 짧은 표시명을 반환합니다 (괄호 설명 제거).
 */
export function getShortProviderLabel(providerType: ProviderType): string {
	return stripProviderSuffix(PROVIDER_LABELS[providerType] || providerType);
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

// ─── Model Flattening ─────────────────────────────────────────────────────────

/**
 * 프로바이더 배열을 받아 평탄화된 모델 목록을 반환합니다.
 * ModelSelector 등 UI 컴포넌트에서 프로바이더 + 모델 결합 리스트를 렌더링할 때 사용합니다.
 *
 * @param providers - 프로바이더 설정 배열 (isVerified, availableModels 포함)
 * @returns FlattenedModel[] - providerId, modelId, label, value 등이 포함된 평탄화 배열
 */
export function flattenProviderModels(providers: LLMProviderConfig[]): FlattenedModel[] {
	return providers.flatMap((p) =>
		p.availableModels.map((m) => ({
			providerId: p.id,
			providerType: p.type,
			providerName: PROVIDER_LABELS[p.type] || p.type,
			modelId: m,
			label: m,
			value: `${p.id}::${m}`,
		})),
	);
}
