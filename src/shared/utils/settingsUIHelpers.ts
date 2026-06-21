/** 
 * 배럴 파일 (Facade): 하위 호환성을 위해 설정 UI 렌더링 헬퍼 함수 모음 
 * 실제 구현은 src/shared/utils/settings/ 하위 모듈과 각 도메인 모듈에 분리되어 있습니다.
 */

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
	addModelSelector 
} from './fuzzyModelSuggestModal';

// Re-exports (Connection Notices)
export {
	showConnectionSuccess,
	showSyncFailNotice,
	showDisconnectedNotice,
	showConnectedNotice,
	getConnectionStatus,
	refreshAfterConnectionToggle,
	refreshAfterMcpConnectionToggle,
} from './connectionNoticeUtils';

// Locales Helpers
export {
	getSystemLocale,
	getLangSuffix,
} from '../locales/helpers';

// Model Utils
export {
	warnIfReasoningModel,
	REASONING_MODEL_NOTICE_DURATION,
} from './modelUtils';

export const MCP_REFRESH_DELAY = 1500;