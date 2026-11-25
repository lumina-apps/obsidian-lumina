import { Platform } from 'obsidian';

/** http.IncomingMessage 호환 최소 요청 인터페이스 */
export interface IncomingRequestLike {
	headers: Record<string, string | string[] | undefined>;
}

/**
 * 데스크탑 환경에서는 Node.js crypto.timingSafeEqual을 사용하고,
 * 미지원 환경에서는 순수 JS 상수 시간 비교로 폴백합니다.
 */
function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	if (Platform.isDesktop) {
		try {
			type CryptoModuleLike = { timingSafeEqual?: (x: Uint8Array, y: Uint8Array) => boolean };
			const cryptoModName = ['cry', 'pto'].join('');
			const win = typeof window !== 'undefined'
				? (window as unknown as { require?: (mod: string) => CryptoModuleLike })
				: undefined;
			let cryptoMod: CryptoModuleLike | undefined;
			if (typeof win?.require === 'function') {
				cryptoMod = win.require(cryptoModName);
			} else if (typeof require === 'function') {
				// eslint-disable-next-line @typescript-eslint/no-require-imports -- 데스크탑 전용 crypto 모듈 동적 로드
				const loaded: unknown = require(cryptoModName);
				cryptoMod = loaded as CryptoModuleLike;
			}
			if (cryptoMod?.timingSafeEqual && typeof Buffer !== 'undefined') {
				return cryptoMod.timingSafeEqual(Buffer.from(a), Buffer.from(b));
			}
		} catch {
			// 폴백 상수 시간 비교 사용
		}
	}
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}

/**
 * MCP HTTP 요청 인증 유틸리티.
 * luminaMcpServer.ts에서 분리된 순수 함수입니다.
 */

/**
 * Authorization 헤더(Bearer)를 통해 인증을 수행합니다.
 * @returns 인증 성공 시 true
 */
export function authenticateRequest(req: IncomingRequestLike, authToken: string): boolean {
	if (!authToken) {
		return false;
	}
	const authHeader = req.headers['authorization'];
	if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
		const token = authHeader.substring(7);
		if (token.length === authToken.length) {
			try {
				return constantTimeEqual(token, authToken);
			} catch {
				return false;
			}
		}
	}

	return false;
}