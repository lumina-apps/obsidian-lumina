/** 타임스탬프 → HH:MM */
export function formatTime(ts: number, locale?: string): string {
	return new Date(ts).toLocaleTimeString(locale, {
		hour: "2-digit",
		minute: "2-digit",
	});
}

/** 타임스탬프 → 로케일에 맞춘 "M/D HH:MM" */
export function formatDate(ts: number, locale?: string): string {
	const d = new Date(ts);
	return d.toLocaleString(locale, {
		month: "numeric",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}
