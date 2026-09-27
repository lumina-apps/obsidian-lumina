/** 배럴 파일: 하위 호환성을 위한 re-export 전용 */

// Async
export { wrapAsync } from './asyncUtils';

// Error
export { normalizeError } from './errorUtils';

// Model
export {
	isEmbeddingModel,
	buildProviderModelOptions,
	buildChatModelOptions,
	buildEmbeddingModelOptions,
	buildDedicatedModelOptions,
	parseProviderModelValue,
	toProviderModelValue,
	sortModelOptionsWithFavorites,
	warnIfReasoningModel,
	REASONING_MODEL_NOTICE_DURATION,
} from './modelUtils';
export type { ModelOption, ModelFilterFn, ParsedProviderModel } from './modelUtils';

// IME
export { createComposingSafeTextHandler, createImeTextBinding, createImePasswordBinding } from './imeUtils';
export type { ComposingSafeHandler } from './imeUtils';

// DOM
export { createFeatureCard, createMultilineDesc } from './domUtils';

// Types
export type {
	DescButtonOptions,
	ToggleOptions,
	TextInputOptions,
	DropdownOptions,
	SliderRangeOptions,
	SecretFieldOptions,
	ModelSuggestItem,
} from '../types/settingsUI.types';

// UI Controls
export {
	addDescButton,
	addToggle,
	addTextInput,
	addDropdown,
	addSliderRange,
	addSliderWithInput,
	addSecretField,
} from './settings/controls';

// UI Decorators
export {
	sectionHeading,
	advancedLabel,
	infoBox,
} from './settings/decorators';

// UI Errors
export {
	showSettingError,
	showSecretFieldError,
} from './settings/errors';

// Re-exports (Fuzzy Model Suggest)
export {
	FUZZY_MODAL_THRESHOLD,
	FuzzyModelSuggestModal,
	addModelSelector,
} from './fuzzyModelSuggestModal';

// Re-exports (Connection Notices)
export {
	showConnectionSuccess,
	showSyncFailNotice,
	showDisconnectedNotice,
	showConnectedNotice,
	getConnectionStatus,
} from './connectionNoticeUtils';

// Locales Helpers
export {
	getSystemLocale,
	getLangSuffix,
} from '../locales/helpers';

export const MCP_REFRESH_DELAY = 1500;
