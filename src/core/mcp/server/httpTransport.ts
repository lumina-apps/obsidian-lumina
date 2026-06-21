import * as http from 'http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { debugLogger } from '../../../shared/debugLogger';
import { authenticateRequest } from './auth';

/**
 * HTTP 전송 계층.
 * SSE 기반 MCP 서버의 HTTP 서버 수명주기, 세션 관리, CORS, 라우팅을 담당합니다.
 */
export class HttpTransport {
	private httpServer: http.Server | null = null;
	private transports = new Map<string, StreamableHTTPServerTransport>();
	private isRunning = false;
	public port: number;
	public authToken: string;

	constructor(port: number, authToken: string) {
		this.port = port;
		this.authToken = authToken;
	}

	/** 현재 모든 활성 SSE 세션 ID */
	get sessionIds(): string[] {
		return Array.from(this.transports.keys());
	}

	/**
	 * HTTP 서버를 시작하고 지정된 포트에 바인딩합니다.
	 * @param mcpServer McpServer 인스턴스 (connect 용)
	 */
	async start(mcpServer: McpServer): Promise<void> {
		if (this.isRunning) return;
		this.isRunning = true;

		this.httpServer = http.createServer((req, res) => {
			void this.handleRequest(req, res, mcpServer);
		});

		return new Promise<void>((resolve, reject) => {
			let currentPort = this.port;
			let attempts = 0;
			const maxAttempts = 10;

			const tryListen = () => {
				this.httpServer?.listen(currentPort, () => {
					debugLogger.logSystem('mcp', `MCP HTTP server started on port ${currentPort}`);
					this.port = currentPort;
					resolve();
				});
			};

			this.httpServer?.on('error', (err: NodeJS.ErrnoException) => {
				if (err.code === 'EADDRINUSE') {
					debugLogger.logSystem('mcp', `Port ${currentPort} is in use. Trying next port...`);
					attempts++;
					if (attempts < maxAttempts) {
						currentPort++;
						tryListen();
					} else {
						debugLogger.logError('mcp', new Error(`MCP Server failed to start after ${maxAttempts} attempts.`));
						this.isRunning = false;
						reject(err);
					}
				} else {
					debugLogger.logError('mcp', err instanceof Error ? err : new Error(`MCP Server failed to start: ${err}`));
					this.isRunning = false;
					reject(err);
				}
			});

			tryListen();
		});
	}

	/** HTTP 서버를 중지하고 모든 세션을 정리합니다. */
	async stop(): Promise<void> {
		this.isRunning = false;
		for (const transport of this.transports.values()) {
			try { await transport.close(); } catch { /* ignore */ }
		}
		this.transports.clear();
		if (this.httpServer) {
			await new Promise<void>((resolve) => {
				this.httpServer!.close(() => resolve());
				// 3초 후 강제 해제 (Fallback)
				window.setTimeout(() => resolve(), 3000);
			});
			this.httpServer = null;
		}
		debugLogger.logSystem('mcp', `MCP HTTP server stopped.`);
	}

	// ─── 내부 요청 처리 ─────────────────────────────────────────────────────

	private setCorsHeaders(res: http.ServerResponse): void {
		res.setHeader('Access-Control-Allow-Origin', 'app://obsidian.md');
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-protocol-version, mcp-session-id');
		res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id, mcp-protocol-version');
	}

	private parseBody(req: http.IncomingMessage): Promise<unknown> {
		return new Promise((resolve, reject) => {
			let body = '';
			req.on('data', (chunk: Buffer) => {
				body += chunk.toString();
			});
			req.on('end', () => {
				try {
					resolve(body ? JSON.parse(body) : null);
				} catch (e) {
					reject(e instanceof Error ? e : new Error(String(e)));
				}
			});
			req.on('error', (err) => {
				reject(err instanceof Error ? err : new Error(String(err)));
			});
		});
	}

	private isInitializeMessage(msg: unknown): boolean {
		return (
			typeof msg === 'object' &&
			msg !== null &&
			'method' in msg &&
			(msg as Record<string, unknown>).method === 'initialize'
		);
	}

	private async handleRequest(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		mcpServer: McpServer,
	): Promise<void> {
		try {
			this.setCorsHeaders(res);

			if (req.method === 'OPTIONS') {
				res.writeHead(200);
				res.end();
				return;
			}

			// POST 본문 파싱
			let parsedBody: unknown = null;
			if (req.method === 'POST') {
				try {
					parsedBody = await this.parseBody(req);
				} catch (e) {
					debugLogger.logError('mcp', e instanceof Error ? e : new Error(`Body parse error: ${e}`));
					res.writeHead(400, { 'Content-Type': 'application/json' });
					res.end(JSON.stringify({
						jsonrpc: '2.0',
						error: { code: -32700, message: 'Parse error: Invalid JSON' },
						id: null,
					}));
					return;
				}
			}

			// Initialize 감지
			const isInit = req.method === 'POST' && (
				Array.isArray(parsedBody)
					? parsedBody.some((msg) => this.isInitializeMessage(msg))
					: this.isInitializeMessage(parsedBody)
			);

			// SSE 엔드포인트
			if (req.url?.startsWith('/sse')) {
				await this.handleSseRequest(req, res, parsedBody, isInit, mcpServer);
				return;
			}

			// message 엔드포인트
			if (req.url?.startsWith('/message') && req.method === 'POST') {
				await this.handleMessageRequest(req, res, parsedBody);
				return;
			}

			res.writeHead(404, { 'Content-Type': 'text/plain' });
			res.end('Not Found');
		} catch (err) {
			debugLogger.logError('mcp', err instanceof Error ? err : new Error(`HTTP 요청 처리 중 예외: ${err}`));
			if (!res.headersSent) {
				res.writeHead(500, { 'Content-Type': 'text/plain' });
				res.end('Internal Server Error');
			}
		}
	}

	private async handleSseRequest(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		parsedBody: unknown,
		isInit: boolean,
		mcpServer: McpServer,
	): Promise<void> {
		// 인증
		if (!authenticateRequest(req, this.authToken)) {
			res.writeHead(401, { 'Content-Type': 'text/plain' });
			res.end('Unauthorized');
			return;
		}

		const sessionId = req.headers['mcp-session-id'] as string | undefined;

		if (isInit) {
			debugLogger.logSystem('mcp', 'POST /sse: 새로운 SSE 연결 초기화 시작');
			// Local MCP Server는 single-client: 기존 연결 모두 해제
			for (const oldTransport of this.transports.values()) {
				try { await oldTransport.close(); } catch { /* ignore */ }
			}
			this.transports.clear();

			const newTransport = new StreamableHTTPServerTransport({
				sessionIdGenerator: () => crypto.randomUUID(),
				onsessioninitialized: (sid: string) => {
					debugLogger.logSystem('mcp', `✅ SSE 세션 초기화 완료: ${sid}`);
					this.transports.set(sid, newTransport);
				},
			});

			newTransport.onclose = () => {
				const sid = newTransport.sessionId;
				if (sid && this.transports.has(sid)) {
					debugLogger.logSystem('mcp', `SSE 세션 종료: ${sid}`);
					this.transports.delete(sid);
				}
			};

			await mcpServer.connect(newTransport);
			await newTransport.handleRequest(req, res, parsedBody);
			return;
		}

		// GET / POST / DELETE: sessionId 필수
		if (!sessionId) {
			debugLogger.logSystem('mcp', `${req.method} /sse: mcp-session-id 없음`);
			res.writeHead(400, { 'Content-Type': 'text/plain' });
			res.end('Bad Request: Mcp-Session-Id header is required');
			return;
		}

		const transport = this.transports.get(sessionId);
		if (!transport) {
			debugLogger.logSystem('mcp', `${req.method} /sse: 세션 ${sessionId}을 찾을 수 없음`);
			res.writeHead(404, { 'Content-Type': 'text/plain' });
			res.end('Session not found');
			return;
		}

		await transport.handleRequest(req, res, parsedBody);
	}

	private async handleMessageRequest(
		req: http.IncomingMessage,
		res: http.ServerResponse,
		parsedBody: unknown,
	): Promise<void> {
		if (!authenticateRequest(req, this.authToken)) {
			res.writeHead(401, { 'Content-Type': 'text/plain' });
			res.end('Unauthorized');
			return;
		}

		const sessionId = req.headers['mcp-session-id'] as string | undefined;
		if (!sessionId) {
			debugLogger.logSystem('mcp', 'POST /message: mcp-session-id 없음');
			res.writeHead(400, { 'Content-Type': 'text/plain' });
			res.end('Bad Request: Mcp-Session-Id header is required');
			return;
		}

		const transport = this.transports.get(sessionId);
		if (!transport) {
			debugLogger.logSystem('mcp', `POST /message: 세션 ${sessionId}을 찾을 수 없음`);
			res.writeHead(404, { 'Content-Type': 'text/plain' });
			res.end('Session not found');
			return;
		}

		await transport.handleRequest(req, res, parsedBody);
	}
}