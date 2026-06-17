/** 타임스탬프 → HH:MM */
export function formatTime(ts: number, locale?: string): string {
	return new Date(ts).toLocaleTimeString(locale, {
		hour: "2-digit",
		minute: "2-digit",
	});
}

/** 타임스탬프 → "M월 D일 HH:MM" */
export function formatDate(ts: number): string {
	const d = new Date(ts);
	return `${d.getMonth() + 1}월 ${d.getDate()}일 ${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
}
