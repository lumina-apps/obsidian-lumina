/** 경량 문자열 해시 (DJB2) */
export function hashString(str: string): number {
	let hash = 5381;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) + hash) + str.charCodeAt(i);
	}
	return hash >>> 0;
}