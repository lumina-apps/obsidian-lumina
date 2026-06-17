/**
 * settingHelpers.ts — 배럴 파일 (backward compatibility)
 *
 * 이 파일은 하위 호환성을 유지하기 위한 re-export 전용 배럴입니다.
 * 각 기능은 다음 모듈로 분리되었습니다:
 *   - asyncUtils.ts    → wrapAsync
 *   - errorUtils.ts    → normalizeError
 *   - modelUtils.ts    → ModelOption, ModelFilterFn, ParsedProviderModel,
 *                        isEmbeddingModel, buildProviderModelOptions,
 *                        buildChatModelOptions, buildEmbeddingModelOptions,
 *                        parseProviderModelValue, toProviderModelValue
 *   - imeUtils.ts      → ComposingSafeHandler, createComposingSafeTextHandler,
 *                        createImeTextBinding, createImePasswordBinding
 *   - domUtils.ts      → createFeatureCard, createMultilineDesc
 *   - settingsUIHelpers.ts → FUZZY_MODAL_THRESHOLD, MCP_REFRESH_DELAY,
 *                            REASONING_MODEL_NOTICE_DURATION,
 *                            addSliderWithInput, addModelSelector,
 *                            FuzzyModelSuggestModal, ModelSuggestItem
 */

// Async
export { wrapAsync } from './asyncUtils';

// Error
export { normalizeError } from './errorUtils';

// Model
export { isEmbeddingModel, buildProviderModelOptions, buildChatModelOptions, buildEmbeddingModelOptions, parseProviderModelValue, toProviderModelValue } from './modelUtils';
export type { ModelOption, ModelFilterFn, ParsedProviderModel } from './modelUtils';

// IME
export { createComposingSafeTextHandler, createImeTextBinding, createImePasswordBinding } from './imeUtils';
export type { ComposingSafeHandler } from './imeUtils';

// DOM
export { createFeatureCard, createMultilineDesc } from './domUtils';

// Settings UI
export { FUZZY_MODAL_THRESHOLD, MCP_REFRESH_DELAY, REASONING_MODEL_NOTICE_DURATION, addSliderWithInput, addModelSelector, FuzzyModelSuggestModal } from './settingsUIHelpers';
export type { ModelSuggestItem } from './settingsUIHelpers';