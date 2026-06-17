/**
 * uuid.ts
 *
 * 경량 UUID 생성 유틸. 구형 Electron(Obsidian Stable) 대응 폴리필 포함.
 */

/** crypto.randomUUID() 폴백: 구형 Electron(Obsidian Stable)에서 undefined인 경우 대응 */
export function generateUUID(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		return crypto.randomUUID();
	}
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
	});
}