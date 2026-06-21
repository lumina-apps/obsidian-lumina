import { Notice, Setting } from 'obsidian';
import { normalizeError } from '../errorUtils';

/** ❌ + 메시지 오류 Fragment */
function createErrorFragment(message: string): DocumentFragment {
	return createFragment(el => {
		el.createSpan({ text: '❌ ' });
		el.createSpan({ text: message });
	});
}

/** Desc + Notice 오류 표시 */
export function showSettingError(setting: Setting, errorMessage: string): void {
	const normalizedMessage = normalizeError(errorMessage).message;
	setting.setDesc(createErrorFragment(normalizedMessage));
	new Notice(normalizedMessage);
}

/** Secret 필드 오류 표시 */
export async function showSecretFieldError(
	setting: Setting,
	errorMessage: string,
	delayMs: number = 5000,
): Promise<void> {
	const normalizedMessage = normalizeError(errorMessage).message;
	setting.setDesc(createErrorFragment(normalizedMessage));
	new Notice(normalizedMessage);
	await sleep(delayMs);
}
