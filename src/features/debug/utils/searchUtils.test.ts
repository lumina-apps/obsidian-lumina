import { describe, it, expect } from 'vitest';
import type {
	LLMRequestLog,
	LLMResponseLog,
	RAGSearchLog,
	SystemLog,
	ErrorLog,
	MCPLog,
} from '../../../shared/types/debug.types';
import {
	safeJsonStringify,
	tokenizeSearchQuery,
	getSearchableText,
	matchesSearchQuery,
	splitHighlightSegments,
} from './searchUtils';

describe('searchUtils', () => {
	describe('safeJsonStringify', () => {
		it('일반 객체를 JSON 문자열로 직렬화한다', () => {
			expect(safeJsonStringify({ a: 1, b: 'ok' })).toBe('{"a":1,"b":"ok"}');
			expect(safeJsonStringify({ a: 1 }, 2)).toBe('{\n  "a": 1\n}');
		});

		it('순환 참조를 [Circular]로 치환하여 예외 없이 직렬화한다', () => {
			const obj: Record<string, unknown> = { name: 'root' };
			obj.self = obj;
			const json = safeJsonStringify(obj);
			expect(json).toBe('{"name":"root","self":"[Circular]"}');
		});

		it('BigInt 값을 문자열로 안전하게 직렬화한다', () => {
			const data = { count: BigInt('9007199254740993') };
			expect(safeJsonStringify(data)).toBe('{"count":"9007199254740993"}');
		});
	});

	describe('tokenizeSearchQuery', () => {
		it('공백으로 분리하고 소문자화 및 중복 제거한다', () => {
			expect(tokenizeSearchQuery('  MCP   Read_Note mcp  ')).toEqual(['mcp', 'read_note']);
		});

		it('빈 문자열 또는 공백만 있으면 빈 배열을 반환한다', () => {
			expect(tokenizeSearchQuery('')).toEqual([]);
			expect(tokenizeSearchQuery('   \t\n  ')).toEqual([]);
		});
	});

	describe('matchesSearchQuery & getSearchableText', () => {
		const reqEntry: LLMRequestLog = {
			id: '1',
			type: 'llm-request',
			timestamp: 1000,
			provider: 'anthropic',
			model: 'claude-sonnet-4',
			temperature: 0.3,
			maxTokens: 2048,
			stream: true,
			reasoning: 'high',
			systemPrompt: 'You are Lumina assistant.',
			messages: [{ role: 'user', content: 'Summarize Obsidian notes' }],
			ragChunks: [
				{
					filePath: 'notes/ProjectPlan.md',
					score: 0.91,
					preview: 'Phase 1...',
					fullContent: 'Phase 1 architecture milestone',
				},
			],
		};

		const resEntry: LLMResponseLog = {
			id: '2',
			type: 'llm-response',
			timestamp: 2000,
			requestId: 'req-abc-999',
			model: 'gpt-4o',
			content: 'Done! Updated summary.',
			durationMs: 420,
			stopReason: 'end_turn',
		};

		const ragEntry: RAGSearchLog = {
			id: '3',
			type: 'rag',
			timestamp: 3000,
			query: 'vector embedding index',
			topK: 5,
			durationMs: 35,
			chunks: [
				{
					filePath: 'docs/RAG.md',
					score: 0.88,
					preview: 'HNSW preview',
					fullContent: 'HNSW cosine similarity details',
				},
			],
		};

		const sysEntry: SystemLog = {
			id: '4',
			type: 'system',
			timestamp: 4000,
			event: 'indexing-complete',
			message: 'Indexed 42 files',
			meta: { vault: 'MainVault', elapsedMs: 1200 },
		};

		const errEntry: ErrorLog = {
			id: '5',
			type: 'error',
			timestamp: 5000,
			domain: 'mcp-client',
			message: 'Connection timeout',
			stack: 'Error: Connection timeout\n  at connectServer (client.ts:88)',
		};

		const mcpEntry: MCPLog = {
			id: '6',
			type: 'mcp',
			timestamp: 6000,
			action: 'callTool',
			message: 'read_note executed',
			data: { path: 'Daily/2026-11-28.md', status: 'ok' },
		};

		it('빈 토큰이면 모든 로그와 매칭된다', () => {
			expect(matchesSearchQuery(reqEntry, [])).toBe(true);
			expect(matchesSearchQuery(errEntry, [])).toBe(true);
		});

		it('6개 로그 타입별 상세 필드를 대소문자 무시로 검색한다', () => {
			expect(matchesSearchQuery(reqEntry, tokenizeSearchQuery('PROJECTPLAN.MD milestone'))).toBe(true);
			expect(matchesSearchQuery(reqEntry, tokenizeSearchQuery('anthropic high'))).toBe(true);
			expect(matchesSearchQuery(resEntry, tokenizeSearchQuery('REQ-ABC-999 end_turn'))).toBe(true);
			expect(matchesSearchQuery(ragEntry, tokenizeSearchQuery('embedding cosine'))).toBe(true);
			expect(matchesSearchQuery(sysEntry, tokenizeSearchQuery('indexing-complete MainVault'))).toBe(true);
			expect(matchesSearchQuery(errEntry, tokenizeSearchQuery('mcp-client client.ts:88'))).toBe(true);
			expect(matchesSearchQuery(mcpEntry, tokenizeSearchQuery('callTool Daily/2026-11-28.md'))).toBe(true);
		});

		it('다중 키워드 AND 조건에서 하나라도 없으면 false를 반환한다', () => {
			expect(matchesSearchQuery(errEntry, tokenizeSearchQuery('timeout nonexistent'))).toBe(false);
		});

		it('정규식 특수문자 포함 검색어도 리터럴로 안전하게 매칭한다', () => {
			expect(matchesSearchQuery(errEntry, tokenizeSearchQuery('(client.ts:88)'))).toBe(true);
		});

		it('동일 엔트리 객체에 대해 캐시된 검색 텍스트를 일관되게 반환한다', () => {
			const first = getSearchableText(sysEntry);
			const second = getSearchableText(sysEntry);
			expect(first).toBe(second);
			expect(first).toContain('mainvault');
		});
	});

	describe('splitHighlightSegments', () => {
		it('토큰이 비어있거나 텍스트가 비어있으면 분할하지 않는다', () => {
			expect(splitHighlightSegments('Hello World', [])).toEqual([
				{ text: 'Hello World', matched: false },
			]);
			expect(splitHighlightSegments('', ['hello'])).toEqual([
				{ text: '', matched: false },
			]);
		});

		it('단일/다중 토큰을 매칭하며 원본 대소문자를 보존한다', () => {
			const segments = splitHighlightSegments(
				'Error in MCP Client: mcp timeout',
				['mcp', 'timeout'],
			);
			expect(segments).toEqual([
				{ text: 'Error in ', matched: false },
				{ text: 'MCP', matched: true },
				{ text: ' Client: ', matched: false },
				{ text: 'mcp', matched: true },
				{ text: ' ', matched: false },
				{ text: 'timeout', matched: true },
			]);
		});

		it('겹치는 접두사가 있을 때 긴 토큰을 우선 매칭한다', () => {
			const segments = splitHighlightSegments('ErrorLogEntry', ['err', 'errorlog']);
			expect(segments).toEqual([
				{ text: 'ErrorLog', matched: true },
				{ text: 'Entry', matched: false },
			]);
		});

		it('정규식 특수문자가 포함된 토큰도 안전하게 하이라이트한다', () => {
			const segments = splitHighlightSegments('at fn (file.ts:12)', ['(file.ts:12)']);
			expect(segments).toEqual([
				{ text: 'at fn ', matched: false },
				{ text: '(file.ts:12)', matched: true },
			]);
		});
	});
});
