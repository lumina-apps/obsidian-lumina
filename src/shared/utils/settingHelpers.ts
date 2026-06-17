/** 배럴 파일: 하위 호환성을 위한 re-export 전용 */

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

// Settings UI (re-exported from settingsUIHelpers → fuzzyModelSuggestModal / connectionNoticeUtils)
export { FUZZY_MODAL_THRESHOLD, MCP_REFRESH_DELAY, REASONING_MODEL_NOTICE_DURATION, addSliderWithInput, addModelSelector, FuzzyModelSuggestModal } from './settingsUIHelpers';
export type { ModelSuggestItem } from './settingsUIHelpers';
