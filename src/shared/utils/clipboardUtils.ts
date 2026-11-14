import { Notice } from 'obsidian';
import { debugLogger } from '../debugLogger';
import { normalizeError } from './errorUtils';

/** 클립보드 복사 유틸 */
export async function copyToClipboard(
	text: string,
	successMessage = 'Copied to clipboard',
): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		new Notice(successMessage);
	} catch (err) {
		debugLogger.logError('clipboard', normalizeError(err, `Failed to copy to clipboard: ${err}`));
	}
}