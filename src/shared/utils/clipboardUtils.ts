/**
 * clipboardUtils.ts
 *
 * 클립보드 복사 공통 유틸리티.
 * DebugPanel, ChatPanel 등 여러 곳에서 활용 가능.
 */

/**
 * 텍스트를 클립보드에 복사하고 성공 시 Notice를 표시합니다.
 * @param text 복사할 텍스트
 * @param successMessage 성공 시 표시할 메시지 (기본값: 'Copied to clipboard')
 */
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