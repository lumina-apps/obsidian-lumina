import * as http from 'http';

/**
 * MCP HTTP 요청 인증 유틸리티.
 * luminaMcpServer.ts에서 분리된 순수 함수입니다.
 */

/**
 * Authorization 헤더(Bearer)를 통해 인증을 수행합니다.
 * @returns 인증 성공 시 true
 */
export function authenticateRequest(req: http.IncomingMessage, authToken: string): boolean {
	const authHeader = req.headers['authorization'];
	if (authHeader && authHeader.startsWith('Bearer ')) {
		const token = authHeader.substring(7);
		if (token === authToken) return true;
	}

	return false;
}