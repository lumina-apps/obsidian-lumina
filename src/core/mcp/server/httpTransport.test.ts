import { describe, it, expect, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import * as http from 'http';
import * as net from 'net';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { HttpTransport, MAX_MCP_BODY_BYTES } from './httpTransport';
import { authenticateRequest } from './auth';

function dispatchRequest(
	transport: HttpTransport,
	opts: {
		method: string;
		url: string;
		headers?: Record<string, string>;
		chunks?: Array<Buffer | string>;
	},
): Promise<{ status: number; headers: Record<string, string>; body: string; resumed: boolean }> {
	return new Promise((resolve) => {
		const internal = transport as unknown as { httpServer: http.Server };
		const reqEmitter = new EventEmitter() as http.IncomingMessage & { resumed: boolean };
		reqEmitter.method = opts.method;
		reqEmitter.url = opts.url;
		reqEmitter.headers = Object.fromEntries(
			Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]),
		);
		reqEmitter.resumed = false;
		reqEmitter.resume = () => {
			reqEmitter.resumed = true;
			return reqEmitter;
		};

		const resHeaders: Record<string, string> = {};
		let statusCode = 200;
		let responseBody = '';
		const resObj = {
			headersSent: false,
			setHeader(name: string, value: string) {
				resHeaders[name.toLowerCase()] = String(value);
			},
			writeHead(code: number, hdrs?: Record<string, string>) {
				statusCode = code;
				resObj.headersSent = true;
				if (hdrs) {
					for (const [k, v] of Object.entries(hdrs)) {
						resHeaders[k.toLowerCase()] = v;
					}
				}
				return resObj;
			},
			end(chunk?: string | Buffer) {
				if (chunk !== undefined) {
					responseBody += typeof chunk === 'string' ? chunk : chunk.toString('utf-8');
				}
				resolve({
					status: statusCode,
					headers: resHeaders,
					body: responseBody,
					resumed: reqEmitter.resumed,
				});
				return resObj;
			},
		};
		const res = resObj as unknown as http.ServerResponse;

		internal.httpServer.emit('request', reqEmitter, res);

		queueMicrotask(() => {
			for (const chunk of opts.chunks ?? []) {
				reqEmitter.emit('data', typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
			}
			reqEmitter.emit('end');
		});
	});
}

describe('HttpTransport security & lifecycle', () => {
	const activeTransports: HttpTransport[] = [];
	const activeBlockers: net.Server[] = [];

	const mockMcpServer = {
		connect: async () => {},
	} as unknown as McpServer;

	afterEach(async () => {
		for (const t of activeTransports.splice(0)) {
			await t.stop();
		}
		for (const s of activeBlockers.splice(0)) {
			await new Promise<void>((resolve) => s.close(() => resolve()));
		}
	});

	it('binds strictly to loopback (127.0.0.1 / ::1) and never 0.0.0.0 or ::', async () => {
		const transport = new HttpTransport(19410, 'secret-token-123');
		activeTransports.push(transport);

		await transport.start(mockMcpServer);

		const internal = transport as unknown as {
			httpServer: http.Server | null;
			ipv6Server: http.Server | null;
		};
		const v4Addr = internal.httpServer?.address() as net.AddressInfo | null;
		expect(v4Addr).not.toBeNull();
		expect(v4Addr?.address).toBe('127.0.0.1');

		if (internal.ipv6Server) {
			const v6Addr = internal.ipv6Server.address() as net.AddressInfo | null;
			expect(v6Addr?.address).toBe('::1');
		}
	});

	it('falls back to the next port when 127.0.0.1 is already in use', async () => {
		const blocker = net.createServer();
		activeBlockers.push(blocker);
		await new Promise<void>((resolve) => blocker.listen(19420, '127.0.0.1', () => resolve()));

		const transport = new HttpTransport(19420, 'secret-token-123');
		activeTransports.push(transport);

		await transport.start(mockMcpServer);
		expect(transport.port).toBeGreaterThan(19420);
	});

	it('rejects unauthenticated POST requests with 401 before parsing the body', async () => {
		const transport = new HttpTransport(19430, 'secret-token-123');
		activeTransports.push(transport);
		await transport.start(mockMcpServer);

		// Invalid JSON without auth header must return 401 (auth runs before parseBody), not 400
		const res = await dispatchRequest(transport, {
			method: 'POST',
			url: '/sse',
			headers: { 'Content-Type': 'application/json' },
			chunks: ['{malformed-json'],
		});
		expect(res.status).toBe(401);
		expect(res.resumed).toBe(true);
	});

	it('returns 400 for authenticated POST with malformed JSON', async () => {
		const transport = new HttpTransport(19440, 'secret-token-123');
		activeTransports.push(transport);
		await transport.start(mockMcpServer);

		const res = await dispatchRequest(transport, {
			method: 'POST',
			url: '/sse',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer secret-token-123',
			},
			chunks: ['{malformed-json'],
		});
		expect(res.status).toBe(400);
		expect(res.body).toContain('Parse error');
	});

	it('returns 413 when Content-Length exceeds MAX_MCP_BODY_BYTES', async () => {
		const transport = new HttpTransport(19450, 'secret-token-123');
		activeTransports.push(transport);
		await transport.start(mockMcpServer);

		const res = await dispatchRequest(transport, {
			method: 'POST',
			url: '/sse',
			headers: {
				'Content-Type': 'application/json',
				Authorization: 'Bearer secret-token-123',
				'Content-Length': String(MAX_MCP_BODY_BYTES + 1024),
			},
		});

		expect(res.status).toBe(413);
		expect(res.body).toContain('Payload Too Large');
	});

	it('allows OPTIONS preflight without authentication', async () => {
		const transport = new HttpTransport(19460, 'secret-token-123');
		activeTransports.push(transport);
		await transport.start(mockMcpServer);

		const res = await dispatchRequest(transport, {
			method: 'OPTIONS',
			url: '/sse',
		});
		expect(res.status).toBe(200);
	});

	it('authenticateRequest rejects empty authToken', () => {
		const fakeReq = {
			headers: { authorization: 'Bearer ' },
		} as unknown as http.IncomingMessage;
		expect(authenticateRequest(fakeReq, '')).toBe(false);
	});
});
