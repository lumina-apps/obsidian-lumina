/**
 * dateUtils.ts
 *
 * 날짜/시간 포맷팅 공통 유틸리티.
 * Message.svelte, ChatHistoryList.svelte 등에서 공통 사용.
 */

/**
 * 타임스탬프를 시간 형식(HH:MM)으로 포맷합니다.
 * @param ts Unix epoch milliseconds
 * @param locale 로케일 문자열 (예: "ko-KR", "en-US")
 */
export function formatTime(ts: number, locale?: string): string {
	return new Date(ts).toLocaleTimeString(locale, {
		hour: "2-digit",
		minute: "2-digit",
	});
}