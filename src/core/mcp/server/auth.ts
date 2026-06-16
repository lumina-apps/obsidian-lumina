import * as http from 'http';

/**
 * MCP HTTP 요청 인증 유틸리티.
 * luminaMcpServer.ts에서 분리된 순수 함수입니다.
 */

/**
 * Authorization 헤더(Bearer) 또는 query param(token)을 통해 인증을 수행합니다.
 * @returns 인증 성공 시 true
 */
export function authenticateRequest(req: http.IncomingMessage, authToken: string): boolean {
	const authHeader = req.headers['authorization'];
	if (authHeader && authHeader.startsWith('Bearer ')) {
		const token = authHeader.substring(7);
		if (token === authToken) return true;
	}

	try {
		if (req.url) {
			const url = new URL(req.url, 'http://localhost');
			const token = url.searchParams.get('token');
			if (token === authToken) return true;
		}
	} catch {
		// URL parse error → 인증 실패로 간주
	}

	return false;
}