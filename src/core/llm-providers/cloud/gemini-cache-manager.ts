/**
 * gemini-cache-manager.ts
 * Google Gemini Explicit Context Caching (/v1beta/cachedContents) 생명주기 관리
 */
import { debugLogger } from '../../../shared/debugLogger';
import { estimateTokens } from '../../../shared/utils/tokenEstimator';
import { requestUrlWithAbort } from '../provider-helpers';

/** Gemini Explicit 캐시 기본 최소 추정 토큰 임계치 (Gemini 3 등 기본값) */
export const GEMINI_EXPLICIT_CACHE_MIN_TOKENS = 4096;
/** 기본 Gemini Explicit 캐시 TTL (초) */
export const DEFAULT_GEMINI_CACHE_TTL_SECONDS = 300;
/** 실패한 캐시 해시의 재시도 방지 쿨다운 시간 (ms) */
const FAILURE_COOLDOWN_MS = 5 * 60 * 1000;
/** 캐시 만료 직전 경계 여유 시간 (ms) */
const EXPIRY_SAFETY_BUFFER_MS = 15_000;
/** 남은 TTL이 이 값 미만이면 백그라운드 PATCH 연장 (ms) */
const RENEW_THRESHOLD_MS = 60_000;

export interface GeminiCacheEntry {
	name: string;
	model: string;
	apiKey: string;
	sessionKey: string;
	expiresAt: number;
}

export interface ExplicitCacheSplitResult {
	cacheSystemInstruction?: unknown;
	cacheContents: unknown[];
	tailContents: unknown[];
	estimatedTokens: number;
}

export interface ResolveExplicitCacheParams {
	providerId: string;
	apiKey: string;
	model: string;
	formattedContents: unknown[];
	systemInstruction?: unknown;
	formattedTools?: unknown;
	ttlSeconds?: number;
	sessionKey?: string;
	signal?: AbortSignal;
}

export interface ResolvedExplicitCache {
	cacheName: string;
	tailContents: unknown[];
	cacheHash: string;
}

/**
 * Gemini 모델별 Explicit Context Caching 최소 입력 토큰 임계치를 반환합니다.
 * - Gemini 2.5 Flash: 1,024토큰
 * - Gemini 2.5 Pro / 2.0 계열: 2,048토큰
 * - 그 외 (Gemini 3 등): 4,096토큰
 */
export function getGeminiExplicitCacheMinTokens(model: string): number {
	const clean = model.replace(/^models\//, '').toLowerCase();
	if (clean.startsWith('gemini-2.5-flash')) return 1024;
	if (clean.startsWith('gemini-2.5-pro') || clean.startsWith('gemini-2.0')) return 2048;
	return GEMINI_EXPLICIT_CACHE_MIN_TOKENS;
}

/**
 * 모델이 Gemini Explicit Context Caching을 지원하는지 판별합니다.
 * Gemini 4 계열과 임베딩 모델은 Explicit 캐싱을 지원하지 않습니다(Implicit 전용 또는 미지원).
 */
export function supportsGeminiExplicitCaching(model: string): boolean {
	const clean = model.replace(/^models\//, '').toLowerCase();
	if (!clean.startsWith('gemini-')) return false;
	if (clean.includes('embedding')) return false;
	if (/^gemini-4(?:$|[.-])/.test(clean)) return false;
	return true;
}

/**
 * 순수 JS 기반 결정적 64-bit FNV-1a 이중 해시 (브라우저/모바일 호환).
 */
export function computeCacheHash(input: string): string {
	let h1 = 0x811c9dc5;
	let h2 = 0x01000193;
	for (let i = 0; i < input.length; i++) {
		const code = input.charCodeAt(i);
		h1 ^= code;
		h1 = Math.imul(h1, 0x01000193);
		h2 ^= code + (i & 0xff);
		h2 = Math.imul(h2, 0x85ebca6b);
	}
	return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0');
}

/** systemInstruction 객체에서 텍스트 본문을 추출합니다. */
function extractSystemInstructionText(systemInstruction: unknown): string {
	if (!systemInstruction || typeof systemInstruction !== 'object') return '';
	const parts = (systemInstruction as { parts?: Array<{ text?: string }> }).parts;
	if (!Array.isArray(parts)) return '';
	return parts.map((p) => (typeof p?.text === 'string' ? p.text : '')).filter(Boolean).join('\n');
}

/**
 * Gemini /v1beta/cachedContents API의 `contents` 필수 제약을 만족시키기 위해
 * systemInstruction(또는 첨부 `<context>` 섹션)을 non-empty `cacheContents`로 분리합니다.
 */
function extractSystemToCacheParts(systemInstruction?: unknown): {
	cacheSystemInstruction?: unknown;
	cacheContents: unknown[];
} {
	const sysText = extractSystemInstructionText(systemInstruction);
	if (!sysText) {
		return {
			cacheContents: [
				{ role: 'user', parts: [{ text: 'Tools initialized.' }] },
				{ role: 'model', parts: [{ text: 'Ready.' }] },
			],
		};
	}

	const contextIdx = sysText.indexOf('<context>\n');
	if (contextIdx >= 0) {
		const staticPrefix = sysText.slice(0, contextIdx).trim();
		const contextPart = sysText.slice(contextIdx).trim();
		return {
			...(staticPrefix ? { cacheSystemInstruction: { parts: [{ text: staticPrefix }] } } : {}),
			cacheContents: [
				{ role: 'user', parts: [{ text: contextPart }] },
				{ role: 'model', parts: [{ text: 'Understood. I will use the provided context.' }] },
			],
		};
	}

	return {
		cacheContents: [
			{ role: 'user', parts: [{ text: sysText }] },
			{ role: 'model', parts: [{ text: 'Understood.' }] },
		],
	};
}

/**
 * 캐시 프리픽스(systemInstruction + tools + 선택적 prefix contents)와 tailContents를 분리합니다.
 * - Gemini `/v1beta/cachedContents`는 반드시 비어있지 않은 `contents` 배열이 필요합니다.
 * - systemInstruction + tools만으로 모델별 임계치 이상이면 `<context>` 또는 system 본문을 `cacheContents`로 분리해
 *   대화 턴이 늘어나도 동일 해시로 재사용할 수 있도록 전체 formattedContents를 tailContents로 남깁니다.
 * - 추정 토큰이 최소 임계치 미만이면 null을 반환해 서버측 Implicit Caching에 위임합니다.
 */
export function splitForExplicitCache(
	formattedContents: unknown[],
	systemInstruction?: unknown,
	formattedTools?: unknown,
	model = 'gemini-3',
): ExplicitCacheSplitResult | null {
	if (formattedContents.length === 0) {
		return null;
	}

	const minTokens = getGeminiExplicitCacheMinTokens(model);
	const baseParts: Record<string, unknown> = {};
	if (systemInstruction) {
		baseParts.systemInstruction = systemInstruction;
	}
	if (formattedTools) {
		baseParts.tools = formattedTools;
	}

	if (Object.keys(baseParts).length > 0) {
		const baseEstimated = estimateTokens(JSON.stringify(baseParts), 'google');
		if (baseEstimated >= minTokens) {
			const { cacheSystemInstruction, cacheContents } = extractSystemToCacheParts(systemInstruction);
			return {
				...(cacheSystemInstruction ? { cacheSystemInstruction } : {}),
				cacheContents,
				tailContents: formattedContents,
				estimatedTokens: baseEstimated,
			};
		}
	}

	if (formattedContents.length < 2) {
		return null;
	}

	const prefixContents = formattedContents.slice(0, -1);
	const tailContents = formattedContents.slice(-1);

	const cacheableParts: Record<string, unknown> = {
		...baseParts,
		contents: prefixContents,
	};

	const serialized = JSON.stringify(cacheableParts);
	const estimated = estimateTokens(serialized, 'google');
	if (estimated < minTokens) {
		return null;
	}

	return {
		...(systemInstruction ? { cacheSystemInstruction: systemInstruction } : {}),
		cacheContents: prefixContents,
		tailContents,
		estimatedTokens: estimated,
	};
}

/**
 * Google Gemini Explicit Context Caching 리소스(`cachedContents`)를 관리하는 매니저 클래스입니다.
 */
export class GeminiContextCacheManager {
	private readonly entries = new Map<string, GeminiCacheEntry>();
	private readonly cooldowns = new Map<string, number>();

	/**
	 * 기존 유효 캐시를 재사용하거나 새 `cachedContents` 리소스를 생성합니다.
	 * 미지원 모델, 토큰 미달, 생성 실패 시 예외를 던지지 않고 null을 반환해 일반 요청으로 폴백합니다.
	 */
	async getOrCreateCache(params: ResolveExplicitCacheParams): Promise<ResolvedExplicitCache | null> {
		const {
			providerId,
			apiKey,
			model,
			formattedContents,
			systemInstruction,
			formattedTools,
			ttlSeconds = DEFAULT_GEMINI_CACHE_TTL_SECONDS,
			sessionKey = 'default',
			signal,
		} = params;

		if (!apiKey || !supportsGeminiExplicitCaching(model)) {
			debugLogger.logSystem('prompt-cache', `Gemini explicit cache skipped (unsupported model: ${model})`);
			return null;
		}

		const split = splitForExplicitCache(formattedContents, systemInstruction, formattedTools, model);
		if (!split) {
			debugLogger.logSystem(
				'prompt-cache',
				`Gemini explicit cache skipped (below min ${getGeminiExplicitCacheMinTokens(model)} tokens for ${model})`,
			);
			return null;
		}

		const cleanModel = model.replace(/^models\//, '');
		const hashSource = JSON.stringify({
			providerId,
			model: cleanModel,
			systemInstruction: split.cacheSystemInstruction ?? null,
			tools: formattedTools ?? null,
			cacheContents: split.cacheContents,
		});
		const cacheHash = computeCacheHash(hashSource);
		const now = Date.now();

		const cooldownUntil = this.cooldowns.get(cacheHash);
		if (cooldownUntil && cooldownUntil > now) {
			debugLogger.logSystem('prompt-cache', `Gemini explicit cache skipped (cooldown active for ${cleanModel})`);
			return null;
		}

		const existing = this.entries.get(cacheHash);
		if (existing && existing.expiresAt - now > EXPIRY_SAFETY_BUFFER_MS) {
			if (existing.expiresAt - now < RENEW_THRESHOLD_MS) {
				void this.renewCacheTtl(existing, ttlSeconds);
			}
			debugLogger.logSystem('prompt-cache', `Gemini explicit cache hit: ${existing.name}`, {
				model: cleanModel,
				estimatedTokens: split.estimatedTokens,
			});
			return {
				cacheName: existing.name,
				tailContents: split.tailContents,
				cacheHash,
			};
		}

		if (existing) {
			this.entries.delete(cacheHash);
		}

		const bodyPayload: Record<string, unknown> = {
			model: `models/${cleanModel}`,
			ttl: `${Math.max(60, ttlSeconds)}s`,
			contents: split.cacheContents,
		};
		if (split.cacheSystemInstruction) {
			bodyPayload.systemInstruction = split.cacheSystemInstruction;
		}
		if (formattedTools) {
			bodyPayload.tools = formattedTools;
		}

		try {
			const res = await requestUrlWithAbort({
				url: 'https://generativelanguage.googleapis.com/v1beta/cachedContents',
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'x-goog-api-key': apiKey,
				},
				body: JSON.stringify(bodyPayload),
			}, signal);

			const data = res.json as { name?: string; expireTime?: string } | undefined;
			if (!data?.name) {
				this.cooldowns.set(cacheHash, Date.now() + FAILURE_COOLDOWN_MS);
				return null;
			}

			const parsedExpire = data.expireTime ? Date.parse(data.expireTime) : NaN;
			const expiresAt = Number.isFinite(parsedExpire)
				? parsedExpire
				: Date.now() + Math.max(60, ttlSeconds) * 1000;

			this.entries.set(cacheHash, {
				name: data.name,
				model: cleanModel,
				apiKey,
				sessionKey,
				expiresAt,
			});

			debugLogger.logSystem('prompt-cache', `Gemini explicit cache created: ${data.name}`, {
				model: cleanModel,
				estimatedTokens: split.estimatedTokens,
				ttlSeconds: Math.max(60, ttlSeconds),
			});

			return {
				cacheName: data.name,
				tailContents: split.tailContents,
				cacheHash,
			};
		} catch (err: unknown) {
			if (err instanceof Error && err.name === 'AbortError') {
				throw err;
			}
			const errObj = err && typeof err === 'object' ? (err as { text?: string; status?: number }) : null;
			const detail = errObj?.text ? ` (${errObj.text})` : '';
			debugLogger.logWarn(
				'llm',
				`Gemini explicit cache creation failed for ${cleanModel}; falling back to standard request: ${err instanceof Error ? err.message : String(err)}${detail}`,
			);
			this.cooldowns.set(cacheHash, Date.now() + FAILURE_COOLDOWN_MS);
			return null;
		}
	}

	/** 만료/오류가 발생한 캐시 엔트리를 무효화하고 짧은 쿨다운을 설정합니다. */
	invalidate(cacheHash: string): void {
		this.entries.delete(cacheHash);
		this.cooldowns.set(cacheHash, Date.now() + FAILURE_COOLDOWN_MS);
	}

	/** 특정 세션에서 생성한 캐시 리소스를 서버에서 best-effort로 삭제합니다. */
	async clearSession(sessionKey: string): Promise<void> {
		const targets: GeminiCacheEntry[] = [];
		for (const [hash, entry] of this.entries.entries()) {
			if (entry.sessionKey === sessionKey) {
				this.entries.delete(hash);
				targets.push(entry);
			}
		}
		await Promise.allSettled(targets.map((entry) => this.deleteRemoteCache(entry)));
	}

	/** 플러그인 언로드 시 모든 활성 캐시 리소스를 서버에서 best-effort로 정리합니다. */
	async destroyAll(): Promise<void> {
		const targets = Array.from(this.entries.values());
		this.entries.clear();
		this.cooldowns.clear();
		await Promise.allSettled(targets.map((entry) => this.deleteRemoteCache(entry)));
	}

	private async renewCacheTtl(entry: GeminiCacheEntry, ttlSeconds: number): Promise<void> {
		try {
			const effectiveTtl = Math.max(60, ttlSeconds);
			const res = await requestUrlWithAbort({
				url: `https://generativelanguage.googleapis.com/v1beta/${entry.name}`,
				method: 'PATCH',
				headers: {
					'Content-Type': 'application/json',
					'x-goog-api-key': entry.apiKey,
				},
				body: JSON.stringify({ ttl: `${effectiveTtl}s` }),
			});
			const data = res.json as { expireTime?: string } | undefined;
			const parsedExpire = data?.expireTime ? Date.parse(data.expireTime) : NaN;
			entry.expiresAt = Number.isFinite(parsedExpire)
				? parsedExpire
				: Date.now() + effectiveTtl * 1000;
		} catch (err: unknown) {
			debugLogger.logWarn(
				'llm',
				`Gemini explicit cache TTL renewal failed (${entry.name}): ${err instanceof Error ? err.message : String(err)}`,
			);
		}
	}

	private async deleteRemoteCache(entry: GeminiCacheEntry): Promise<void> {
		try {
			await requestUrlWithAbort({
				url: `https://generativelanguage.googleapis.com/v1beta/${entry.name}`,
				method: 'DELETE',
				headers: {
					'x-goog-api-key': entry.apiKey,
				},
			});
		} catch {
			// 이미 만료되었거나 삭제된 캐시는 무시
		}
	}
}

export const geminiContextCacheManager = new GeminiContextCacheManager();
