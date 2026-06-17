/**
 * settingHelpers.ts
 *
 * 설정 탭에서 공통으로 사용되는 유틸리티 함수 모음.
 * - 모델 옵션 빌더
 * - 프로바이더-모델 값 파싱
 * - IME 입력 안전 텍스트 핸들러
 */

import { PROVIDER_LABELS, PROVIDER_CATEGORIES } from '../types/settings.types';
import type { LLMProviderConfig, ProviderType } from '../types/settings.types';
import { isEmbeddingModel } from '../../core/settings/settingTab';

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

// ─── IME-safe Text Handler ────────────────────────────────────────────────────

/**
 * IME 입력(한글, 일본어 등) 중에는 onChange가 발동하지 않도록
 * compositionstart/compositionend 이벤트를 처리하는 핸들러를 input 요소에 부착합니다.
 *
 * Usage:
 * ```
 * const handler = createComposingSafeTextHandler(inputEl, (value) => {
 *   someState = value;
 *   void tab.saveAndSync();
 * });
 * // handler.dispose()로 이벤트 제거 가능
 * ```
 */
export interface ComposingSafeHandler {
	/** 이벤트 리스너를 제거합니다 */
	dispose: () => void;
	/** 현재 composing 상태인지 여부 */
	isComposing: () => boolean;
}

export function createComposingSafeTextHandler(
	inputEl: HTMLInputElement | HTMLTextAreaElement,
	onCommit: (value: string) => void,
): ComposingSafeHandler {
	let composing = false;

	const onCompositionStart = () => { composing = true; };
	const onCompositionEnd = () => {
		composing = false;
		onCommit(inputEl.value);
	};
	const onChange = () => {
		if (composing) return;
		onCommit(inputEl.value);
	};

	inputEl.addEventListener('compositionstart', onCompositionStart);
	inputEl.addEventListener('compositionend', onCompositionEnd);
	// input 이벤트는 composition과 별도로 발생하므로 직접 감시
	inputEl.addEventListener('input', onChange);

	return {
		dispose: () => {
			inputEl.removeEventListener('compositionstart', onCompositionStart);
			inputEl.removeEventListener('compositionend', onCompositionEnd);
			inputEl.removeEventListener('input', onChange);
		},
		isComposing: () => composing,
	};
}

// ─── Error Normalizer ─────────────────────────────────────────────────────────

/**
 * unknown 타입의 에러를 Error 객체로 정규화합니다.
 * debugLogger.logError 등의 호출부에서 반복되는 instanceof 체크를 제거하기 위함.
 */
export function normalizeError(err: unknown, fallbackMessage: string = '알 수 없는 오류'): Error {
	if (err instanceof Error) return err;
	return new Error(typeof err === 'string' ? err : fallbackMessage);
}