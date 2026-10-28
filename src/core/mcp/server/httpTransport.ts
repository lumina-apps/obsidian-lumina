import * as http from 'http';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { debugLogger } from '../../../shared/debugLogger';
import { normalizeError } from '../../../shared/utils/errorUtils';
import { authenticateRequest } from './auth';

/**
 * POST 요청 본문 최대 허용 크기 (80 MiB).
 * save_attachment 도구의 최대 base64 길이(70MB)와 JSON-RPC 래퍼 오버헤드를 수용합니다.
 */
export const MAX_MCP_BODY_BYTES = 80 * 1024 * 1024;

/** McpServer 인스턴스 또는 새 인스턴스를 생성하는 팩토리 함수 */
export type McpServerOrFactory = McpServer | (() => McpServer);

class PayloadTooLargeError extends Error {
	constructor() {
		super('Payload Too Large');
		this.name = 'PayloadTooLargeError';
	}
}

/**
 * HTTP 전송 계층.
 * SSE 기반 MCP 서버의 HTTP 서버 수명주기, 세션 관리, CORS, 라우팅을 담당합니다.
 */
export class HttpTransport {
	private httpServer: http.Server | null = null;
	private ipv6Server: http.Server | null = null;
	private transports = new Map<string, StreamableHTTPServerTransport>();
	private isRunning = false;
	private mcpServerOrFactory: McpServerOrFactory | null = null;
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
	 * HTTP 서버를 시작하고 루프백 인터페이스(127.0.0.1 및 가능한 경우 ::1)의 지정된 포트에 바인딩합니다.
	 * @param mcpServerOrFactory McpServer 인스턴스 또는 새 세션마다 인스턴스를 생성하는 팩토리
	 */
	async start(mcpServerOrFactory: McpServerOrFactory): Promise<void> {
		if (this.isRunning) return;
		this.isRunning = true;
		this.mcpServerOrFactory = mcpServerOrFactory;

		const requestListener: http.RequestListener = (req, res) => {
			void this.handleRequest(req, res);
		};

		const tryListenOnPort = (portToTry: number): Promise<{ v4: http.Server; v6: http.Server | null }> => {
			return new Promise((resolvePort, rejectPort) => {
				const v4 = http.createServer(requestListener);
				const onV4Error = (err: NodeJS.ErrnoException) => {
					rejectPort(err);
				};
				v4.once('error', onV4Error);
				v4.listen(portToTry, '127.0.0.1', () => {
					v4.removeListener('error', onV4Error);

					// localhost가 ::1로 먼저 해석되는 환경을 위해 IPv6 루프백도 함께 바인딩합니다.
					const v6 = http.createServer(requestListener);
					const onV6Error = (err: NodeJS.ErrnoException) => {
						if (err.code === 'EADDRINUSE') {
							v4.close(() => rejectPort(err));
						} else {
							// IPv6가 비활성화된 시스템(EADDRNOTAVAIL, EAFNOSUPPORT 등)에서는 IPv4만으로 동작
							resolvePort({ v4, v6: null });
						}
					};
					v6.once('error', onV6Error);
					v6.listen({ port: portToTry, host: '::1', ipv6Only: true }, () => {
						v6.removeListener('error', onV6Error);
						resolvePort({ v4, v6 });
					});
				});
			});
		};

		let currentPort = this.port;
		const maxAttempts = 10;

		for (let attempts = 0; attempts < maxAttempts; attempts++) {
			try {
				const { v4, v6 } = await tryListenOnPort(currentPort);
				v4.on('error', (err) => {
					debugLogger.logError('mcp', normalizeError(err, `MCP IPv4 server error: ${err}`));
				});
				v6?.on('error', (err) => {
					debugLogger.logError('mcp', normalizeError(err, `MCP IPv6 server error: ${err}`));
				});
				this.httpServer = v4;
				this.ipv6Server = v6;
				this.port = currentPort;
				debugLogger.logSystem('mcp', `MCP HTTP server started on 127.0.0.1:${currentPort}`);
				return;
			} catch (err) {
				const errno = err as NodeJS.ErrnoException;
				if (errno.code === 'EADDRINUSE') {
					debugLogger.logSystem('mcp', `Port ${currentPort} is in use. Trying next port...`);
					currentPort++;
					if (attempts + 1 >= maxAttempts) {
						debugLogger.logError('mcp', new Error(`MCP Server failed to start after ${maxAttempts} attempts.`));
						this.isRunning = false;
						throw err;
					}
				} else {
					debugLogger.logError('mcp', normalizeError(err, `MCP Server failed to start: ${err}`));
					this.isRunning = false;
					throw err;
				}
			}
		}
	}

	/** 단일 http.Server 인스턴스를 타임아웃과 함께 안전하게 종료합니다. */
	private async closeServerInstance(server: http.Server | null): Promise<void> {
		if (!server) return;
		await new Promise<void>((resolve) => {
			let resolved = false;
			const timeoutId = window.setTimeout(() => {
				if (!resolved) {
					resolved = true;
					resolve();
				}
			}, 3000);
			server.close(() => {
				if (!resolved) {
					resolved = true;
					window.clearTimeout(timeoutId);
					resolve();
				}
			});
		});
	}

	/** HTTP 서버를 중지하고 모든 세션을 정리합니다. */
	async stop(): Promise<void> {
		this.isRunning = false;
		for (const transport of this.transports.values()) {
			try { await transport.close(); } catch { /* ignore */ }
		}
		this.transports.clear();
		const v4 = this.httpServer;
		const v6 = this.ipv6Server;
		this.httpServer = null;
		this.ipv6Server = null;
		await Promise.all([
			this.closeServerInstance(v4),
			this.closeServerInstance(v6),
		]);
		debugLogger.logSystem('mcp', `MCP HTTP server stopped.`);
	}

	// ─── 내부 요청 처리 ─────────────────────────────────────────────────────

	private setCorsHeaders(req: http.IncomingMessage, res: http.ServerResponse): void {
		const origin = req.headers.origin || '*';
		res.setHeader('Access-Control-Allow-Origin', origin);
		res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, DELETE');
		res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-protocol-version, mcp-session-id');
		res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id, mcp-protocol-version');
	}

	private parseBody(req: http.IncomingMessage): Promise<unknown> {
		return new Promise((resolve, reject) => {
			const contentLengthHeader = req.headers['content-length'];
			const contentLength = contentLengthHeader !== undefined ? Number(contentLengthHeader) : NaN;
			if (Number.isFinite(contentLength) && contentLength > MAX_MCP_BODY_BYTES) {
				req.resume();
				reject(new PayloadTooLargeError());
				return;
			}

			const chunks: Buffer[] = [];
			let totalBytes = 0;
			let rejected = false;

			req.on('data', (chunk: Buffer | string) => {
				if (rejected) return;
				const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
				totalBytes += buf.byteLength;
				if (totalBytes > MAX_MCP_BODY_BYTES) {
					rejected = true;
					chunks.length = 0;
					req.resume();
					reject(new PayloadTooLargeError());
					return;
				}
				chunks.push(buf);
			});
			req.on('end', () => {
				if (rejected) return;
				try {
					const body = Buffer.concat(chunks).toString('utf-8');
					resolve(body ? JSON.parse(body) : null);
				} catch (e) {
					reject(normalizeError(e));
				}
			});
			req.on('error', (err) => {
				if (rejected) return;
				rejected = true;
				reject(normalizeError(err));
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
	): Promise<void> {
		try {
			this.setCorsHeaders(req, res);

			if (req.method === 'OPTIONS') {
				res.writeHead(200);
				res.end();
				return;
			}

			const isSseRoute = Boolean(req.url?.startsWith('/sse'));
			const isMessageRoute = Boolean(req.url?.startsWith('/message') && req.method === 'POST');

			if (!isSseRoute && !isMessageRoute) {
				res.writeHead(404, { 'Content-Type': 'text/plain' });
				res.end('Not Found');
				return;
			}

			// 비인증 요청에 의한 메모리 고갈을 방지하기 위해 본문 파싱 전에 인증을 먼저 수행합니다.
			if (!authenticateRequest(req, this.authToken)) {
				req.resume();
				res.writeHead(401, { 'Content-Type': 'text/plain' });
				res.end('Unauthorized');
				return;
			}

			// POST 본문 파싱
			let parsedBody: unknown = null;
			if (req.method === 'POST') {
				try {
					parsedBody = await this.parseBody(req);
				} catch (e) {
					if (e instanceof PayloadTooLargeError) {
						res.writeHead(413, { 'Content-Type': 'application/json', 'Connection': 'close' });
						res.end(JSON.stringify({
							jsonrpc: '2.0',
							error: { code: -32600, message: 'Payload Too Large' },
							id: null,
						}));
						return;
					}
					debugLogger.logError('mcp', normalizeError(e, `Body parse error: ${e}`));
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
			if (isSseRoute) {
				await this.handleSseRequest(req, res, parsedBody, isInit);
				return;
			}

			// message 엔드포인트
			if (isMessageRoute) {
				await this.handleMessageRequest(req, res, parsedBody);
				return;
			}
		} catch (err) {
			debugLogger.logError('mcp', normalizeError(err, `HTTP 요청 처리 중 예외: ${err}`));
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
			const isFactory = typeof this.mcpServerOrFactory === 'function';

			if (isFactory) {
				// 동시 활성 세션 상한 (최대 20개): 오래된 세션부터 정리
				if (this.transports.size >= 20) {
					const oldestKey = this.transports.keys().next().value;
					if (oldestKey) {
						const oldTransport = this.transports.get(oldestKey);
						try { await oldTransport?.close(); } catch { /* ignore */ }
						this.transports.delete(oldestKey);
					}
				}
			} else {
				// 단일 McpServer 인스턴스 모드: 기존 세션 전체 해제
				for (const oldTransport of this.transports.values()) {
					try { await oldTransport.close(); } catch { /* ignore */ }
				}
				this.transports.clear();
			}

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

			const serverInstance = typeof this.mcpServerOrFactory === 'function'
				? this.mcpServerOrFactory()
				: this.mcpServerOrFactory;

			if (!serverInstance) {
				throw new Error('McpServer instance not configured');
			}

			await serverInstance.connect(newTransport);
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