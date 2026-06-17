/**
 * hash.ts
 *
 * 경량 문자열 해시 유틸.
 */

/** 간단하고 빠른 문자열 해시 함수 (DJB2) */
export function hashString(str: string): number {
	let hash = 5381;
	for (let i = 0; i < str.length; i++) {
		hash = ((hash << 5) + hash) + str.charCodeAt(i); // hash * 33 + c
	}
	return hash >>> 0;
}