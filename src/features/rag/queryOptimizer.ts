/**
 * 경량/저성능/추론형 태스크 모델 오동작으로부터 사용자 경험을 보호하는
 * Fail-Safe 쿼리 최적화기 및 경량 CRAG 재검색 쿼리 생성기.
 *
 * 7중 가드레일:
 * 1. Opt-in 전용 (기본 비활성화)
 * 2. 하드 타임아웃 (기본 8000ms) + AbortController 연동
 * 3. 세션 서킷 브레이커 (연속 3회 실패 시 2분간 0ms 바이패스)
 * 4. 엄격한 출력 살균 (<think> 블록·코드펜스·거절·사족·초장문 폐기)
 * 5. 원본 쿼리 불변 + Additive-only 가중 RRF
 * 6. LLM 검색 스킵 권한 배제
 * 7. 비파괴적(Non-Destructive) CRAG 폴백
 */

import type { LLMProviderConfig } from '../../shared/types/settings.types';
import { createProvider } from '../../core/llm-providers';
import { debugLogger } from '../../shared/debugLogger';
import { normalizeError } from '../../shared/utils/errorUtils';
import { stripThinkTags } from '../../shared/utils/llmTextSanitizer';
import type { WeightedSearchQuery } from './search';

export interface ConversationTurnForQuery {
	role: 'user' | 'assistant';
	content: string;
}

export interface OptimizeQueryParams {
	userText: string;
	recentHistory?: ConversationTurnForQuery[];
	providerConfig: LLMProviderConfig;
	modelId: string;
	signal?: AbortSignal;
	timeoutMs?: number;
	/** CLI 에이전트 등 로컬 작업 디렉토리가 필요한 프로바이더용 경로 */
	cwd?: string;
}

export type QueryOptimizationStatus =
	| 'ok'
	| 'unchanged'
	| 'circuit_open'
	| 'timeout'
	| 'invalid_output'
	| 'error'
	| 'skipped';

export interface OptimizeQueryResult {
	extraQueries: WeightedSearchQuery[];
	status: QueryOptimizationStatus;
	/** 실패/차단 시 디버그 로그 진단을 위한 상세 사유 */
	reason?: string;
}

const DEFAULT_TIMEOUT_MS = 8000;
const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 2 * 60 * 1000;

interface CircuitEntry {
	consecutiveFailures: number;
	openUntil: number;
	lastReason?: string;
}

/**
 * (providerId, modelId) 단위로 연속 실패를 감지해 일시 차단하는 세션 서킷 브레이커.
 */
export class TaskModelCircuitBreaker {
	private readonly entries = new Map<string, CircuitEntry>();

	private buildKey(providerId: string, modelId: string): string {
		return `${providerId}::${modelId}`;
	}

	/** 현재 차단 상태인지 확인합니다. 쿨다운 만료 시 자동으로 닫힙니다. */
	public isOpen(providerId: string, modelId: string, now: number = Date.now()): boolean {
		const key = this.buildKey(providerId, modelId);
		const entry = this.entries.get(key);
		if (!entry) return false;
		if (entry.openUntil > now) {
			return true;
		}
		if (entry.openUntil > 0 && entry.openUntil <= now) {
			this.entries.delete(key);
		}
		return false;
	}

	/** 마지막 실패 사유를 반환합니다 (디버그 진단용). */
	public getLastReason(providerId: string, modelId: string): string | undefined {
		return this.entries.get(this.buildKey(providerId, modelId))?.lastReason;
	}

	/** 성공 시 실패 카운터를 초기화합니다. */
	public recordSuccess(providerId: string, modelId: string): void {
		this.entries.delete(this.buildKey(providerId, modelId));
	}

	/** 실패를 기록하고 임계치 도달 시 쿨다운 동안 서킷을 엽니다. */
	public recordFailure(
		providerId: string,
		modelId: string,
		now: number = Date.now(),
		reason?: string,
	): void {
		const key = this.buildKey(providerId, modelId);
		const prev = this.entries.get(key) ?? { consecutiveFailures: 0, openUntil: 0 };
		const nextCount = prev.consecutiveFailures + 1;
		const openUntil = nextCount >= FAILURE_THRESHOLD ? now + COOLDOWN_MS : 0;
		this.entries.set(key, {
			consecutiveFailures: nextCount,
			openUntil,
			lastReason: reason ?? prev.lastReason,
		});
	}

	/** 테스트 및 모델 설정 변경 시 상태를 초기화합니다. */
	public reset(): void {
		this.entries.clear();
	}
}

export const taskModelCircuitBreaker = new TaskModelCircuitBreaker();

/** 서킷 브레이커 상태를 수동 초기화합니다 (테스트 및 설정 변경 시 사용). */
export function resetQueryOptimizerCircuitBreaker(): void {
	taskModelCircuitBreaker.reset();
}

const REFUSAL_OR_META_PATTERNS: readonly RegExp[] = [
	/\b(i am sorry|i'm sorry|i cannot|i can't|as an ai|unable to|cannot fulfill)\b/i,
	/^(here are|here is|sure,|certainly,|of course,|search quer(?:y|ies):?)/i,
	/^(죄송합니다|죄송하지만|할 수 없습니다|물론입니다|다음은|검색어\s*:|재작성된\s*쿼리)/i,
];

/** 1-Shot 프롬프트 예시를 그대로 따라 적는 초소형 모델 출력 차단 목록 */
const EXAMPLE_ECHO_BLOCKLIST = new Set([
	'q3 launch plan deadline',
	'log retention period archive policy',
]);

interface ParsedQueriesResult {
	queries: string[];
	/** 모델이 원문과 동일한 정상 쿼리만 출력해 재작성이 불필요했던 경우 */
	matchedOriginalOnly: boolean;
	/** 추론/사고 블록만 출력되고 실제 본문 없이 잘린 경우 */
	thinkingOnly: boolean;
	/** 추론 태그 제거 후 남은 정제 전 본문 미리보기 (디버그 진단용) */
	cleanedPreview: string;
}

/**
 * 표준 `<think>/<thought>/<reasoning>` 태그뿐 아니라 Gemma 4 / MLX 계열의
 * `<|channel>thought...<channel|>`, `<|thought|>...<|/thought|>` 채널 토큰까지 모두 제거합니다.
 */
function stripAllReasoningBlocks(raw: string): string {
	let cleaned = raw
		.replace(/<\|channel>thought[\s\S]*?(?:<channel\|>|$)/gi, '')
		.replace(/<\|thought\|>[\s\S]*?(?:<\|\/thought\|>|$)/gi, '');
	cleaned = stripThinkTags(cleaned);
	return cleaned.replace(/<\|[^|]+\|>/g, '').trim();
}

/** 단일 후보 문자열 정제 및 유효성 검사 */
function cleanAndValidateCandidate(
	rawCandidate: string,
	normOriginal: string,
	maxAllowedLen: number,
): { valid: string | null; isOriginal: boolean } {
	let line = rawCandidate
		.trim()
		.replace(/^(?:\d+[.)]|[-*•])\s+/, '')
		.replace(/^(?:query\s*\d*|검색어\s*\d*)\s*[:\-]\s*/i, '')
		.replace(/^\*\*([\s\S]+)\*\*$/, '$1')
		.replace(/^\*([\s\S]+)\*$/, '$1')
		.replace(/^`([\s\S]+)`$/, '$1')
		.trim();

	if (
		(line.startsWith('"') && line.endsWith('"') && line.length >= 2) ||
		(line.startsWith("'") && line.endsWith("'") && line.length >= 2)
	) {
		line = line.slice(1, -1).trim();
	}

	if (line.length < 2 || line.length > maxAllowedLen) {
		return { valid: null, isOriginal: false };
	}
	if (REFUSAL_OR_META_PATTERNS.some(re => re.test(line))) {
		return { valid: null, isOriginal: false };
	}

	const normLine = line.toLowerCase().replace(/\s+/g, ' ');
	if (EXAMPLE_ECHO_BLOCKLIST.has(normLine)) {
		return { valid: null, isOriginal: false };
	}
	if (normLine === normOriginal) {
		return { valid: null, isOriginal: true };
	}

	return { valid: line, isOriginal: false };
}

/** Tier 2: 응답 내 JSON 객체(`{"queries": [...]}`) 또는 문자열 배열(`[...]`)에서 쿼리를 추출합니다. */
function extractJsonCandidates(cleaned: string): string[] {
	const jsonBlocks = Array.from(cleaned.matchAll(/\{[\s\S]*?"queries"\s*:\s*\[[\s\S]*?\][\s\S]*?\}|\[[\s\S]*?\]/g));
	for (let i = jsonBlocks.length - 1; i >= 0; i--) {
		try {
			const parsed: unknown = JSON.parse(jsonBlocks[i][0]);
			const arr: unknown[] | null = Array.isArray(parsed)
				? parsed
				: parsed && typeof parsed === 'object' && Array.isArray((parsed as { queries?: unknown }).queries)
					? (parsed as { queries: unknown[] }).queries
					: null;
			if (!arr) continue;
			const strings = arr
				.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
				.map(s => s.trim());
			if (strings.length > 0) {
				return strings;
			}
		} catch {
			// 유효하지 않은 JSON 조각은 무시하고 다음 후보 확인
		}
	}
	return [];
}

function collectValidatedQueries(
	candidates: readonly string[],
	normOriginal: string,
	maxAllowedLen: number,
	maxQueries: number,
): { valid: string[]; sawOriginalMatch: boolean } {
	const seen = new Set<string>();
	const valid: string[] = [];
	let sawOriginalMatch = false;

	for (const candidate of candidates) {
		const res = cleanAndValidateCandidate(candidate, normOriginal, maxAllowedLen);
		if (res.isOriginal) {
			sawOriginalMatch = true;
			continue;
		}
		if (!res.valid) continue;

		const normLine = res.valid.toLowerCase().replace(/\s+/g, ' ');
		if (seen.has(normLine)) continue;

		seen.add(normLine);
		valid.push(res.valid);
		if (valid.length >= maxQueries) break;
	}

	return { valid, sawOriginalMatch };
}

function parseRewrittenQueries(
	rawOutput: string,
	originalQuery: string,
	maxQueries: number = 2,
): ParsedQueriesResult {
	if (!rawOutput || typeof rawOutput !== 'string') {
		return { queries: [], matchedOriginalOnly: false, thinkingOnly: false, cleanedPreview: '' };
	}

	// 1. 추론/사고 블록 제거
	let cleaned = stripAllReasoningBlocks(rawOutput);
	if (!cleaned) {
		return {
			queries: [],
			matchedOriginalOnly: false,
			thinkingOnly: rawOutput.trim().length > 0,
			cleanedPreview: '',
		};
	}

	// 2. 코드펜스 마커 제거
	cleaned = cleaned.replace(/```[^\n]*\n?/g, '').replace(/```/g, '');

	const normOriginal = originalQuery.trim().toLowerCase().replace(/\s+/g, ' ');
	const maxAllowedLen = Math.max(originalQuery.trim().length * 3, 180);
	const cleanedPreview = cleaned.replace(/\s+/g, ' ').slice(0, 60);

	// Tier 1: <q>...</q> 화이트리스트 태그 추출 (앞뒤 사족·서론·결론 무관)
	const tagMatches = Array.from(cleaned.matchAll(/<q>([\s\S]*?)<\/q>/gi))
		.map(m => m[1])
		.filter(s => s.trim().length > 0);
	if (tagMatches.length > 0) {
		const res = collectValidatedQueries(tagMatches, normOriginal, maxAllowedLen, maxQueries);
		if (res.valid.length > 0 || res.sawOriginalMatch) {
			return {
				queries: res.valid,
				matchedOriginalOnly: res.valid.length === 0 && res.sawOriginalMatch,
				thinkingOnly: false,
				cleanedPreview,
			};
		}
	}

	// Tier 2: JSON({"queries": [...]} 또는 [...]) 추출
	const jsonCandidates = extractJsonCandidates(cleaned);
	if (jsonCandidates.length > 0) {
		const res = collectValidatedQueries(jsonCandidates, normOriginal, maxAllowedLen, maxQueries);
		if (res.valid.length > 0 || res.sawOriginalMatch) {
			return {
				queries: res.valid,
				matchedOriginalOnly: res.valid.length === 0 && res.sawOriginalMatch,
				thinkingOnly: false,
				cleanedPreview,
			};
		}
	}

	// Tier 3: 평문 줄 단위 폴백 (콜론(:)으로 끝나는 헤더 줄은 제외)
	const plainLines = cleaned
		.split(/\r?\n/)
		.map(l => l.trim())
		.filter(l => l.length > 0 && !l.endsWith(':'));
	const plainRes = collectValidatedQueries(plainLines, normOriginal, maxAllowedLen, maxQueries);

	return {
		queries: plainRes.valid,
		matchedOriginalOnly: plainRes.valid.length === 0 && plainRes.sawOriginalMatch,
		thinkingOnly: false,
		cleanedPreview,
	};
}

/**
 * 태스크 모델의 원시 응답에서 추론 블록·마크다운·번호·거절/사족 문장을 제거하고
 * 유효한 검색 쿼리 목록만 추출합니다.
 */
export function sanitizeRewrittenQueries(
	rawOutput: string,
	originalQuery: string,
	maxQueries: number = 2,
): string[] {
	return parseRewrittenQueries(rawOutput, originalQuery, maxQueries).queries;
}

/** 브라우저/워커/노드 테스트 환경을 모두 지원하는 타이머 설정/해제 */
function scheduleTimeout(fn: () => void, ms: number): number {
	if (typeof window !== 'undefined' && typeof window.setTimeout === 'function') {
		return window.setTimeout(fn, ms);
	}
	return globalThis.setTimeout(fn, ms) as unknown as number;
}

function clearScheduledTimeout(id: number): void {
	if (typeof window !== 'undefined' && typeof window.clearTimeout === 'function') {
		window.clearTimeout(id);
		return;
	}
	globalThis.clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
}

async function runChatWithHardTimeout(
	providerConfig: LLMProviderConfig,
	modelId: string,
	prompt: string,
	maxOutputTokens: number,
	timeoutMs: number,
	label: string,
	externalSignal?: AbortSignal,
	cwd?: string,
): Promise<{ content: string; timedOut: boolean }> {
	if (externalSignal?.aborted) {
		throw new DOMException('Aborted', 'AbortError');
	}

	const controller = new AbortController();
	let timedOut = false;

	const onExternalAbort = () => controller.abort();
	externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

	const timerId = scheduleTimeout(() => {
		timedOut = true;
		controller.abort();
	}, timeoutMs);

	const reqStart = Date.now();
	const requestId = debugLogger.logRequest({
		provider: providerConfig.type,
		model: modelId,
		temperature: 0.1,
		maxTokens: maxOutputTokens,
		stream: false,
		systemPrompt: `[${label}]`,
		messages: [{ role: 'user', content: prompt }],
	});

	try {
		const provider = createProvider(providerConfig);
		const response = await provider.chat(
			[{ role: 'user', content: prompt }],
			{
				model: modelId,
				temperature: 0.1,
				maxOutputTokens,
				reasoning: { effort: 'off' },
				signal: controller.signal,
				...(cwd ? { cwd } : {}),
			},
		);
		const content = response?.content ?? '';
		debugLogger.logResponse(requestId, {
			model: modelId,
			content: content.trim() || '(empty)',
			durationMs: Date.now() - reqStart,
			usage: response?.usage,
			...(response?.finishReason ? { stopReason: response.finishReason } : {}),
		});
		return { content, timedOut: false };
	} catch (err) {
		if (externalSignal?.aborted) {
			debugLogger.logResponse(requestId, {
				model: modelId,
				content: '❌ [Aborted by user]',
				durationMs: Date.now() - reqStart,
				stopReason: 'aborted',
			});
			throw err;
		}
		if (timedOut) {
			debugLogger.logResponse(requestId, {
				model: modelId,
				content: `⏱️ [Timeout after ${timeoutMs}ms]`,
				durationMs: Date.now() - reqStart,
				stopReason: 'timeout',
			});
			return { content: '', timedOut: true };
		}
		debugLogger.logResponse(requestId, {
			model: modelId,
			content: `❌ [Error] ${err instanceof Error ? err.message : String(err)}`,
			durationMs: Date.now() - reqStart,
			stopReason: 'error',
		});
		throw err;
	} finally {
		clearScheduledTimeout(timerId);
		externalSignal?.removeEventListener('abort', onExternalAbort);
	}
}

function formatRecentHistorySnippet(history?: ConversationTurnForQuery[]): string {
	if (!history || history.length === 0) return '';
	const recent = history.slice(-4);
	return recent
		.map(turn => {
			const label = turn.role === 'user' ? 'User' : 'Assistant';
			// 이전 어시스턴트 추론 블록이 히스토리 요약을 잠식하지 않도록 먼저 제거
			const stripped = stripAllReasoningBlocks(turn.content);
			const text = stripped.replace(/\s+/g, ' ').trim().slice(0, 250);
			return text ? `${label}: ${text}` : '';
		})
		.filter(Boolean)
		.join('\n');
}

/**
 * 대화 맥락을 반영해 검색용 보조 쿼리(최대 2개)를 생성합니다.
 * 타임아웃·파싱 실패·서킷 오픈 시 예외를 던지지 않고 빈 배열로 안전하게 폴백합니다.
 */
export async function optimizeSearchQueries(
	params: OptimizeQueryParams,
): Promise<OptimizeQueryResult> {
	const {
		userText,
		recentHistory,
		providerConfig,
		modelId,
		signal,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		cwd,
	} = params;

	const trimmedQuery = userText.trim();
	if (!trimmedQuery) {
		return { extraQueries: [], status: 'skipped' };
	}

	if (taskModelCircuitBreaker.isOpen(providerConfig.id, modelId)) {
		const lastReason = taskModelCircuitBreaker.getLastReason(providerConfig.id, modelId);
		debugLogger.logDebug('rag', `Query optimizer circuit open for ${providerConfig.id}/${modelId} (${lastReason ?? 'unknown'})`);
		return { extraQueries: [], status: 'circuit_open', reason: lastReason };
	}

	const historyText = formatRecentHistorySnippet(recentHistory);
	const prompt = `Generate 1 or 2 search queries for an Obsidian knowledge base.
Resolve pronouns from conversation context and keep exact proper nouns/terms.
Wrap each search query in <q>...</q> tags.

Example:
Context: User: Tell me about Q3 launch plan
Question: When is its deadline?
Output: <q>Q3 launch plan deadline</q>
${historyText ? `\nContext:\n${historyText}` : ''}
Question: ${trimmedQuery}
Output:`;

	try {
		const { content, timedOut } = await runChatWithHardTimeout(
			providerConfig,
			modelId,
			prompt,
			1536,
			timeoutMs,
			'RAG Query Optimizer',
			signal,
			cwd,
		);

		if (timedOut) {
			const reason = `timeout(${timeoutMs}ms)`;
			taskModelCircuitBreaker.recordFailure(providerConfig.id, modelId, Date.now(), reason);
			debugLogger.logDebug('rag', `Query optimizer timed out after ${timeoutMs}ms (${modelId})`);
			return { extraQueries: [], status: 'timeout', reason };
		}

		const parsed = parseRewrittenQueries(content, trimmedQuery, 2);
		if (parsed.queries.length === 0) {
			// 원문과 동일한 정상 쿼리를 반환한 경우는 실패(서킷 브레이커 대상)가 아닌 정상 unchanged로 처리
			if (parsed.matchedOriginalOnly) {
				taskModelCircuitBreaker.recordSuccess(providerConfig.id, modelId);
				return { extraQueries: [], status: 'unchanged' };
			}
			const reason = parsed.thinkingOnly
				? 'thinking_only_truncated'
				: content.trim()
					? `filtered_invalid_output: "${parsed.cleanedPreview}"`
					: 'empty_response';
			taskModelCircuitBreaker.recordFailure(providerConfig.id, modelId, Date.now(), reason);
			debugLogger.logDebug('rag', `Query optimizer fallback to original (${modelId}, ${reason})`);
			return { extraQueries: [], status: 'invalid_output', reason };
		}

		taskModelCircuitBreaker.recordSuccess(providerConfig.id, modelId);
		// 짧은 후속 지시어 질문일수록 재작성 쿼리 비중을 높임
		const isShortFollowUp = Boolean(historyText) && trimmedQuery.length <= 40;
		const weight = isShortFollowUp ? 0.85 : 0.6;

		return {
			extraQueries: parsed.queries.map(q => ({ query: q, weight })),
			status: 'ok',
		};
	} catch (err) {
		if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
			throw err;
		}
		const msg = normalizeError(err).message;
		taskModelCircuitBreaker.recordFailure(providerConfig.id, modelId, Date.now(), msg);
		debugLogger.logDebug('rag', `Query optimizer error fallback (${modelId}): ${msg}`);
		return { extraQueries: [], status: 'error', reason: msg };
	}
}

/**
 * 1차 검색 결과가 없거나 신뢰도가 매우 낮을 때(경량 CRAG) 1회 재검색을 위한
 * 넓은 핵심 키워드 쿼리 1개를 생성합니다. 실패 시 null을 반환합니다.
 */
export async function generateBroadFallbackQuery(
	params: Omit<OptimizeQueryParams, 'recentHistory'>,
): Promise<string | null> {
	const {
		userText,
		providerConfig,
		modelId,
		signal,
		timeoutMs = DEFAULT_TIMEOUT_MS,
		cwd,
	} = params;

	const trimmedQuery = userText.trim();
	if (!trimmedQuery) return null;

	if (taskModelCircuitBreaker.isOpen(providerConfig.id, modelId)) {
		return null;
	}

	const prompt = `Extract core keywords and broader synonyms as 1 concise search query wrapped in <q>...</q>.

Example:
Question: How long do we keep archived logs?
Output: <q>log retention period archive policy</q>

Question: ${trimmedQuery}
Output:`;

	try {
		const { content, timedOut } = await runChatWithHardTimeout(
			providerConfig,
			modelId,
			prompt,
			1536,
			timeoutMs,
			'RAG CRAG Fallback',
			signal,
			cwd,
		);

		if (timedOut) {
			taskModelCircuitBreaker.recordFailure(providerConfig.id, modelId, Date.now(), `timeout(${timeoutMs}ms)`);
			return null;
		}

		const parsed = parseRewrittenQueries(content, trimmedQuery, 1);
		if (parsed.queries.length === 0) {
			if (parsed.matchedOriginalOnly) {
				taskModelCircuitBreaker.recordSuccess(providerConfig.id, modelId);
				return null;
			}
			const reason = parsed.thinkingOnly
				? 'thinking_only_truncated'
				: content.trim()
					? `filtered_invalid_output: "${parsed.cleanedPreview}"`
					: 'empty_response';
			taskModelCircuitBreaker.recordFailure(providerConfig.id, modelId, Date.now(), reason);
			return null;
		}

		taskModelCircuitBreaker.recordSuccess(providerConfig.id, modelId);
		return parsed.queries[0];
	} catch (err) {
		if (signal?.aborted || (err instanceof Error && err.name === 'AbortError')) {
			throw err;
		}
		const msg = normalizeError(err).message;
		taskModelCircuitBreaker.recordFailure(providerConfig.id, modelId, Date.now(), msg);
		debugLogger.logDebug('rag', `CRAG fallback error (${modelId}): ${msg}`);
		return null;
	}
}
