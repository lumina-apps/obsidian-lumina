import * as http from 'http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import {
	CallToolRequestSchema,
	ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { TFile, TFolder, normalizePath } from 'obsidian';
import type LuminaPlugin from '../../../main';
import { searchVault, formatRagContext } from '../../../features/rag/search';
import { debugLogger } from '../../../shared/debugLogger';
import { t } from '../../../shared/locales/helpers';

export class LuminaMcpServer {
	private server: Server;
	private httpServer: http.Server | null = null;
	private transport: SSEServerTransport | null = null;
	private connectionReady: Promise<void> | null = null; // SSE 연결 준비 완료 대기용
	public port: number;
	public authToken: string;
	private plugin: LuminaPlugin;
	private isRunning: boolean = false;
	private writeLocks = new Set<string>();

	constructor(plugin: LuminaPlugin, port: number, authToken: string) {
		this.plugin = plugin;
		this.port = port;
		this.authToken = authToken;

		this.server = new Server({
			name: 'Lumina-MCP-Server',
			version: '1.0.0'
		}, {
			capabilities: {
				tools: {}
			}
		});

		this.registerTools();
	}

	private sanitizeFilename(name: string): string {
		return name.replace(/[\\/:*?"<>|]/g, '_');
	}

	private enforceMarkdownExt(path: string): string {
		const norm = normalizePath(path);
		if (!norm.toLowerCase().endsWith('.md')) {
			return norm + '.md';
		}
		return norm;
	}

	private async lock<T>(path: string, fn: () => Promise<T>): Promise<T> {
		if (this.writeLocks.has(path)) {
			throw new Error(`File ${path} is currently being modified by another operation.`);
		}
		this.writeLocks.add(path);
		try {
			return await fn();
		} finally {
			this.writeLocks.delete(path);
		}
	}

	private registerTools() {
		this.server.setRequestHandler(ListToolsRequestSchema, async () => {
			return {
				tools: [
					{
						name: 'read_active_note',
						description: t('mcpServerTools.read_active_note.desc'),
						inputSchema: { type: 'object', properties: {} }
					},
					{
						name: 'read_note',
						description: t('mcpServerTools.read_note.desc'),
						inputSchema: {
							type: 'object',
							properties: {
								path: { type: 'string', description: t('mcpServerTools.read_note.argPath') }
							},
							required: ['path']
						}
					},
					{
						name: 'create_note',
						description: t('mcpServerTools.create_note.desc'),
						inputSchema: {
							type: 'object',
							properties: {
								path: { type: 'string', description: t('mcpServerTools.create_note.argPath') },
								content: { type: 'string', description: t('mcpServerTools.create_note.argContent') }
							},
							required: ['path', 'content']
						}
					},
					{
						name: 'search_notes',
						description: t('mcpServerTools.search_notes.desc'),
						inputSchema: {
							type: 'object',
							properties: {
								query: { type: 'string', description: t('mcpServerTools.search_notes.argQuery') }
							},
							required: ['query']
						}
					},
					{
						name: 'append_to_note',
						description: t('mcpServerTools.append_to_note.desc'),
						inputSchema: {
							type: 'object',
							properties: {
								path: { type: 'string', description: t('mcpServerTools.append_to_note.argPath') },
								content: { type: 'string', description: t('mcpServerTools.append_to_note.argContent') }
							},
							required: ['path', 'content']
						}
					},
					{
						name: 'read_daily_note',
						description: t('mcpServerTools.read_daily_note.desc'),
						inputSchema: { type: 'object', properties: {} }
					},
					{
						name: 'append_to_daily_note',
						description: t('mcpServerTools.append_to_daily_note.desc'),
						inputSchema: {
							type: 'object',
							properties: {
								content: { type: 'string', description: t('mcpServerTools.append_to_daily_note.argContent') }
							},
							required: ['content']
						}
					},
					{
						name: 'rag_search',
						description: t('mcpServerTools.rag_search.desc'),
						inputSchema: {
							type: 'object',
							properties: {
								query: { type: 'string', description: t('mcpServerTools.rag_search.argQuery') },
								top_k: { type: 'number', description: t('mcpServerTools.rag_search.argTopK') },
								min_similarity: { type: 'number', description: t('mcpServerTools.rag_search.argMinSimilarity') }
							},
							required: ['query']
						}
					}
				]
			};
		});

		this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
			const { name, arguments: args } = request.params;
			const limits = this.plugin.settings.mcp;
			const limitRead = limits.serverMaxReadChars || 20000;
			const limitAppend = limits.serverMaxAppendChars || 10000;
			const snippetLen = limits.serverSearchSnippetLength || 300;
			const maxResults = limits.serverSearchMaxResults || 10;

			const applyReadLimit = (content: string) => {
				if (content.length > limitRead) {
					return content.substring(0, limitRead) + t('mcpServerTools.common.truncated', { limit: limitRead });
				}
				return content;
			};

			try {
				switch (name) {
					case 'read_active_note': {
						const activeFile = this.plugin.app.workspace.getActiveFile();
						if (!activeFile) {
							return { content: [{ type: 'text', text: t('mcpServerTools.read_active_note.noActive') }] };
						}
						const content = await this.plugin.app.vault.read(activeFile);
						return { content: [{ type: 'text', text: `[${activeFile.path}]\n${applyReadLimit(content)}` }] };
					}

					case 'read_note': {
						const path = this.enforceMarkdownExt(args?.path as string);
						const file = this.plugin.app.vault.getAbstractFileByPath(path);
						if (!(file instanceof TFile)) {
							return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.read_note.notFound', { path }) }] };
						}
						const content = await this.plugin.app.vault.read(file);
						return { content: [{ type: 'text', text: applyReadLimit(content) }] };
					}

					case 'create_note': {
						let path = args?.path as string;
						let content = args?.content as string || '';
						if (content.length > limitAppend) {
							return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.create_note.tooLong', { limit: limitAppend }) }] };
						}
						
						// 파일명 특수문자 정제 (경로 구분자 / 제외)
						const parts = path.split('/');
						const sanitizedParts = parts.map((p, i) => i === parts.length - 1 ? this.sanitizeFilename(p) : p);
						path = this.enforceMarkdownExt(sanitizedParts.join('/'));
						
						const existingFile = this.plugin.app.vault.getAbstractFileByPath(path);
						if (existingFile) {
							return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.create_note.alreadyExists', { path }) }] };
						}

						// 부모 폴더가 없다면 에러
						const parentPath = path.substring(0, path.lastIndexOf('/'));
						if (parentPath && !this.plugin.app.vault.getAbstractFileByPath(parentPath)) {
							return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.create_note.parentFolderNotFound', { parentPath }) }] };
						}

						await this.lock(path, async () => {
							await this.plugin.app.vault.create(path, content);
						});
						return { content: [{ type: 'text', text: t('mcpServerTools.create_note.success', { path }) }] };
					}

					case 'search_notes': {
						const query = (args?.query as string).toLowerCase();
						const files = this.plugin.app.vault.getMarkdownFiles();
						const results: string[] = [];
						
						for (const file of files) {
							const content = await this.plugin.app.vault.read(file);
							const lowerContent = content.toLowerCase();
							const index = lowerContent.indexOf(query);
							if (index !== -1) {
								const start = Math.max(0, index - snippetLen);
								const end = Math.min(content.length, index + query.length + snippetLen);
								let snippet = content.substring(start, end).replace(/\n/g, ' ');
								if (start > 0) snippet = '...' + snippet;
								if (end < content.length) snippet = snippet + '...';

								results.push(`[${file.path}]\n${snippet}\n`);
								if (results.length >= maxResults) break;
							}
						}
						return { content: [{ type: 'text', text: results.length > 0 ? t('mcpServerTools.search_notes.foundPrefix', { max: maxResults }) + results.join('\n') : t('mcpServerTools.search_notes.noResults') }] };
					}

					case 'append_to_note': {
						const path = this.enforceMarkdownExt(args?.path as string);
						const newContent = args?.content as string;
						
						if (newContent.length > limitAppend) {
							return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.append_to_note.tooLong', { limit: limitAppend }) }] };
						}

						const file = this.plugin.app.vault.getAbstractFileByPath(path);
						if (!(file instanceof TFile)) {
							return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.append_to_note.notFound', { path }) }] };
						}

						return await this.lock(path, async () => {
							const currentContent = await this.plugin.app.vault.read(file);
							if (currentContent.length + newContent.length > 100000) {
								return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.append_to_note.maxLengthExceeded') }] };
							}
							
							await this.plugin.app.vault.modify(file, currentContent + '\n' + newContent);
							return { content: [{ type: 'text', text: t('mcpServerTools.append_to_note.success', { path }) }] };
						});
					}

					case 'read_daily_note': {
						const today = new window.Date().toISOString().split('T')[0];
						const path = `${today}.md`;
						const file = this.plugin.app.vault.getAbstractFileByPath(path);
						if (!(file instanceof TFile)) {
							return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.read_daily_note.notFound', { path }) }] };
						}
						const content = await this.plugin.app.vault.read(file);
						return { content: [{ type: 'text', text: applyReadLimit(content) }] };
					}

					case 'append_to_daily_note': {
						const today = new window.Date().toISOString().split('T')[0];
						const path = `${today}.md`;
						const newContent = args?.content as string;

						if (newContent.length > limitAppend) {
							return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.append_to_daily_note.tooLong', { limit: limitAppend }) }] };
						}

						return await this.lock(path, async () => {
							const file = this.plugin.app.vault.getAbstractFileByPath(path);
							if (file instanceof TFile) {
								const currentContent = await this.plugin.app.vault.read(file);
								if (currentContent.length + newContent.length > 100000) {
									return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.append_to_daily_note.maxLengthExceeded') }] };
								}
								await this.plugin.app.vault.modify(file, currentContent + '\n' + newContent);
								return { content: [{ type: 'text', text: t('mcpServerTools.append_to_daily_note.successAppend', { path }) }] };
							} else {
								await this.plugin.app.vault.create(path, newContent);
								return { content: [{ type: 'text', text: t('mcpServerTools.append_to_daily_note.successCreate', { path }) }] };
							}
						});
					}

					case 'rag_search': {
						const indexer = this.plugin.indexer;
						if (!indexer || indexer.indexedChunks.length === 0) {
							return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.rag_search.notReady') }] };
						}

						const query = args?.query as string;
						if (!query || !query.trim()) {
							return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.rag_search.emptyQuery') }] };
						}

						const topK = typeof args?.top_k === 'number' ? Math.min(args.top_k, maxResults) : Math.min(5, maxResults);
						const minSim = typeof args?.min_similarity === 'number' ? Math.max(0, Math.min(1, args.min_similarity)) : 0.65;

						try {
							const results = await searchVault(
								query,
								indexer.indexedChunks,
								(texts: string[]) => indexer.embed(texts),
								topK,
								minSim,
							);

							if (results.length === 0) {
								return { content: [{ type: 'text', text: t('mcpServerTools.rag_search.noResults') }] };
							}

							const context = formatRagContext(results);
							const summary = t('mcpServerTools.rag_search.summary', { count: results.length, minSim, context });
							return { content: [{ type: 'text', text: applyReadLimit(summary) }] };
						} catch (e) {
							return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.rag_search.error', { error: (e as Error).message }) }] };
						}
					}

					default:
						return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.common.unknownTool') }] };
				}
			} catch (e) {
				return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.common.executionError', { error: (e as Error).message }) }] };
			}
		});
	}

	private authenticate(req: http.IncomingMessage): boolean {
		const authHeader = req.headers['authorization'];
		if (authHeader && authHeader.startsWith('Bearer ')) {
			const token = authHeader.substring(7);
			if (token === this.authToken) return true;
		}

		try {
			if (req.url) {
				const url = new URL(req.url, `http://localhost`);
				const token = url.searchParams.get('token');
				if (token === this.authToken) return true;
			}
		} catch (e) {
			// ignore URL parse errors
		}

		return false;
	}

	public async start() {
		if (this.isRunning) return;
		this.isRunning = true;

		this.httpServer = http.createServer((req, res) => {
			void (async () => {
				try {
					// CORS headers
					res.setHeader('Access-Control-Allow-Origin', '*');
					res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
					res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, mcp-protocol-version');

					if (req.method === 'OPTIONS') {
						res.writeHead(200);
						res.end();
						return;
					}

					if (req.url?.startsWith('/sse')) {
						if (!this.authenticate(req)) {
							res.writeHead(401, { 'Content-Type': 'text/plain' });
							res.end('Unauthorized');
							return;
						}

						// 이전 연결이 있으면 반드시 await로 정리 후 진행
						if (this.transport) {
							debugLogger.logSystem('mcp', '기존 SSE 연결 정리 후 재연결');
							const oldTransport = this.transport;
							this.transport = null;
							this.connectionReady = null;
							try { await oldTransport.close(); } catch (e) {
								// ignore
							}
						}

						// 새 transport 생성 및 서버 연결 (await로 완료 대기)
						this.transport = new SSEServerTransport('/message', res);
						const ready = this.server.connect(this.transport).then(() => {
							debugLogger.logSystem('mcp', '✅ SSE 클라이언트 연결 완료');
						}).catch((e) => {
							debugLogger.logError('mcp', e instanceof Error ? e : new Error(`SSE 서버 연결 실패: ${e}`));
							this.transport = null;
							throw e;
						});
						this.connectionReady = ready;
						try {
							await ready;
						} catch {
							// connect 실패는 이미 로깅됨, 클라이언트는 SSE 응답이 끊어졌으므로 재연결 시도
						}
						return;
					}

					if (req.url?.startsWith('/message')) {
						if (req.method === 'POST') {
							// SSE 연결이 완료될 때까지 대기
							if (this.connectionReady) {
								try { await this.connectionReady; } catch { /* connect 실패, 아래 transport 체크로 처리 */ }
							}
							if (this.transport) {
								await this.transport.handlePostMessage(req, res);
							} else {
								debugLogger.logSystem('mcp', 'POST /message: SSE transport 없음');
								res.writeHead(503, { 'Content-Type': 'text/plain' });
								res.end('SSE transport not established. Reconnect required.');
							}
							return;
						}
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
			})();
		});

		return new Promise<void>((resolve, reject) => {
			let currentPort = this.port;
			let attempts = 0;
			const maxAttempts = 10;

			const tryListen = () => {
				this.httpServer?.listen(currentPort, () => {
					debugLogger.logSystem('mcp', `MCP Server started on port ${currentPort}`);
					this.port = currentPort; // 실제 바인딩된 포트로 업데이트
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

	public async stop() {
		this.isRunning = false;
		if (this.transport) {
			try { await this.transport.close(); } catch { /* ignore */ }
			this.transport = null;
		}
		if (this.httpServer) {
			await new Promise<void>((resolve) => {
				this.httpServer!.close(() => resolve());
				window.setTimeout(() => resolve(), 3000);
			});
			this.httpServer = null;
		}
		debugLogger.logSystem('mcp', `MCP Server stopped.`);
	}
}