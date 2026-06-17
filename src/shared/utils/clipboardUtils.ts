/** 클립보드 복사 유틸 */
export async function copyToClipboard(
	text: string,
	successMessage = 'Copied to clipboard',
): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		const { Notice } = await import('obsidian');
		new Notice(successMessage);
	} catch (err) {
		console.error('[Lumina] Failed to copy to clipboard:', err);
	}
}