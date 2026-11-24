/**
 * provider-helpers.ts
 * LLM REST API Provider 전용 공통 헬퍼 함수
 */
import type { ChatMessage } from '../../shared/types/llm.types';
import { t } from '../../shared/locales/helpers';
import { Platform, requestUrl, type RequestUrlParam, type RequestUrlResponse } from 'obsidian';

export class IdleTimeoutController {
	private controller: AbortController;
	private timeoutId: number | null = null;
	private ttftMs: number;
	private interTokenMs: number;
	
	constructor(
		userSignal: AbortSignal | undefined,
		ttftMs: number | undefined,
		interTokenMs: number | undefined
	) {
		this.controller = new AbortController();
		this.interTokenMs = (interTokenMs && interTokenMs > 0) ? Math.max(interTokenMs, 2000) : 0;
		
		if (userSignal) {
			if (userSignal.aborted) {
				this.controller.abort(userSignal.reason);
			} else {
				userSignal.addEventListener('abort', () => {
					this.controller.abort(userSignal.reason);
				});
			}
		}

		const actualTtft = (ttftMs && ttftMs > 0) ? Math.max(ttftMs, 5000) : 0;
		this.ttftMs = actualTtft;
		if (actualTtft > 0) {
			this.timeoutId = window.setTimeout(() => {
				const err = new Error(t('settings.providerErrors.timeoutTTFT', { fallback: 'Timeout: First token response took too long' }));
				err.name = 'IdleTimeoutError';
				this.controller.abort(err);
			}, actualTtft);
		}
	}
	
	get signal(): AbortSignal {
		return this.controller.signal;
	}

	/**
	 * 모바일 CORS 폴백으로 비스트리밍 요청(`requestUrl`)으로 전환할 때
	 * 짧은 TTFT 타이머를 해제하고 전체 응답 완료까지 대기 가능한 여유 타임아웃으로 재설정합니다.
	 */
	switchToNonStreamingFallback(fallbackTimeoutMs: number = 120_000): void {
		if (this.timeoutId !== null) {
			window.clearTimeout(this.timeoutId);
			this.timeoutId = null;
		}
		if (this.signal.aborted) return;

		const totalBudgetMs = Math.max(fallbackTimeoutMs, this.ttftMs, this.interTokenMs);
		if (totalBudgetMs > 0) {
			this.timeoutId = window.setTimeout(() => {
				const err = new Error(t('settings.providerErrors.timeoutTTFT', { fallback: 'Timeout: Response took too long' }));
				err.name = 'IdleTimeoutError';
				this.controller.abort(err);
			}, totalBudgetMs);
		}
	}
	
	onChunkReceived() {
		if (this.timeoutId !== null) {
			window.clearTimeout(this.timeoutId);
			this.timeoutId = null;
		}
		
		if (this.interTokenMs > 0 && !this.signal.aborted) {
			this.timeoutId = window.setTimeout(() => {
				const err = new Error(t('settings.providerErrors.timeoutInterToken', { fallback: 'Timeout: Stream interrupted or hung' }));
				err.name = 'IdleTimeoutError';
				this.controller.abort(err);
			}, this.interTokenMs);
		}
	}
	
	cleanup() {
		if (this.timeoutId !== null) {
			window.clearTimeout(this.timeoutId);
			this.timeoutId = null;
		}
	}
	
	async run<T>(fn: () => Promise<T>): Promise<T> {
		try {
			return await fn();
		} catch (e: unknown) {
			const err = toError(e);
			const reason = this.controller.signal.reason ? toError(this.controller.signal.reason) : undefined;
			if (err.name === 'AbortError' && reason?.name === 'IdleTimeoutError') {
				throw this.controller.signal.reason;
			}
			throw e;
		} finally {
			this.cleanup();
		}
	}
}


function toError(err: unknown): Error {
	if (err instanceof Error) {
		return err;
	}
	const errObj = err && typeof err === 'object' ? (err as Record<string, unknown>) : null;
	const message = typeof errObj?.message === 'string' ? errObj.message : 'API request failed';
	const errorObj = new Error(message);
	if (errObj) {
		Object.assign(errorObj, errObj);
	}
	return errorObj;
}

/**
 * Obsidian의 requestUrl에 AbortSignal 기능을 추가한 래퍼 함수입니다.
 * AbortSignal이 발생하면 즉시 'AbortError'를 발생시켜 불필요한 대기를 방지합니다.
 */
export async function requestUrlWithAbort(params: RequestUrlParam, signal?: AbortSignal): Promise<RequestUrlResponse> {
	if (signal?.aborted) {
		const error = new Error('Aborted');
		error.name = 'AbortError';
		throw error;
	}

	return new Promise((resolve, reject) => {
		// 모바일 Capacitor 브릿지에서는 throw: false로 요청해 HTTP 4xx/5xx 응답 본문(text/json)을 유실 없이 보존
		const isMobile = typeof Platform !== 'undefined' && Boolean(Platform?.isMobile);
		const reqParams: RequestUrlParam = isMobile ? { ...params, throw: false } : params;
		const reqPromise = requestUrl(reqParams);

		if (!signal) {
			reqPromise
				.then((res) => {
					if (isMobile && typeof res?.status === 'number' && res.status >= 400) {
						const httpErr = Object.assign(new Error(`Request failed, status ${res.status}`), {
							status: res.status,
							text: res.text,
							json: res.json,
							headers: res.headers,
						});
						reject(httpErr);
						return;
					}
					resolve(res);
				})
				.catch((err) => reject(toError(err)));
			return;
		}

		const abortHandler = () => {
			if (signal.reason) {
				reject(toError(signal.reason));
			} else {
				const error = new Error('Aborted');
				error.name = 'AbortError';
				reject(error);
			}
		};

		signal.addEventListener('abort', abortHandler);

		reqPromise
			.then((res) => {
				if (isMobile && typeof res?.status === 'number' && res.status >= 400) {
					const httpErr = Object.assign(new Error(`Request failed, status ${res.status}`), {
						status: res.status,
						text: res.text,
						json: res.json,
						headers: res.headers,
					});
					reject(httpErr);
					return;
				}
				resolve(res);
			})
			.catch((err) => {
				reject(toError(err));
			})
			.finally(() => {
				signal.removeEventListener('abort', abortHandler);
			});
	});
}

/**
 * listModels() 등 API 호출 실패 시 프로바이더별 에러 메시지로 throw합니다.
 * 모든 프로바이더에서 중복되는 catch 블록을 대체합니다.
 */
export function raiseApiError(error: unknown, providerName: string): never {
	const err = error as { status?: string | number; message?: string; text?: string; json?: Record<string, unknown> };
	const status = err.status ? String(err.status) : 'unknown';
	let text = err.message || '';
	if (err.text) {
		try {
			const parsed = JSON.parse(err.text) as { error?: { message?: string } | string; message?: string };
			if (typeof parsed.error === 'object' && parsed.error?.message) {
				text = parsed.error.message;
			} else if (typeof parsed.error === 'string') {
				text = parsed.error;
			} else if (parsed.message) {
				text = parsed.message;
			} else {
				text = err.text;
			}
		} catch {
			text = err.text;
		}
	} else if (err.json) {
		const json = err.json as { error?: { message?: string } | string; message?: string };
		if (typeof json.error === 'object' && json.error?.message) {
			text = json.error.message;
		} else if (typeof json.error === 'string') {
			text = json.error;
		} else if (json.message) {
			text = json.message;
		}
	}
	throw new Error(t('settings.providerErrors.apiError', { provider: providerName, status, text: text.trim() }));
}

/**
 * messages 배열에서 system role 메시지를 추출하여 하나의 문자열로 합칩니다.
 * Gemini/Anthropic 등 system instruction을 별도 필드로 전송하는 API에 사용합니다.
 */
export function extractSystemContent(messages: ChatMessage[]): string | undefined {
	const systemMsgs = messages.filter(m => m.role === 'system');
	if (systemMsgs.length === 0) return undefined;
	return systemMsgs.map(m => {
		if (typeof m.content === 'string') return m.content;
		if (Array.isArray(m.content)) {
			return m.content
				.filter((c): c is { type: 'text'; text: string } => c.type === 'text')
				.map(c => c.text)
				.join('\n');
		}
		return '';
	}).filter(Boolean).join('\n');
}

/**
 * ReadableStream의 응답을 한 라인씩 분할하여 콜백으로 전달합니다.
 */
export async function readStreamLines(
	response: Response,
	signal: AbortSignal | undefined,
	onLine: (line: string) => void
): Promise<void> {
	const reader = response.body?.getReader();
	if (!reader) {
		throw new Error(t('errors.llm.notReadable'));
	}
	const decoder = new TextDecoder('utf-8');
	let buffer = '';

	try {
		while (true) {
			if (signal?.aborted) {
				await reader.cancel();
				break;
			}
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';

			for (const line of lines) {
				onLine(line);
			}
		}
		if (buffer && !signal?.aborted) {
			onLine(buffer);
		}
	} finally {
		reader.releaseLock();
	}
}

/**
 * 모바일 WebView에서 스트리밍 window.fetch()가 CORS·네트워크 TypeError로 차단됐는지 판별합니다.
 * 데스크탑 환경이나 AbortError/IdleTimeoutError, HTTP 상태 오류에서는 폴백하지 않습니다.
 */
export function isMobileStreamingCorsFallbackError(err: unknown): err is TypeError {
	if (typeof Platform === 'undefined' || !Platform?.isMobile) {
		return false;
	}
	if (!(err instanceof TypeError)) {
		return false;
	}
	if (err.name === 'AbortError' || err.name === 'IdleTimeoutError') {
		return false;
	}
	return true;
}