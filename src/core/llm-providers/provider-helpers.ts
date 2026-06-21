/**
 * provider-helpers.ts
 * LLM REST API Provider 전용 공통 헬퍼 함수
 */
import type { ChatMessage } from '../../shared/types/llm.types';
import { t } from '../../shared/locales/helpers';
import { requestUrl, type RequestUrlParam, type RequestUrlResponse } from 'obsidian';

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
		const reqPromise = requestUrl(params);
		
		if (!signal) {
			reqPromise.then(resolve).catch(reject);
			return;
		}

		const abortHandler = () => {
			const error = new Error('Aborted');
			error.name = 'AbortError';
			reject(error);
		};

		signal.addEventListener('abort', abortHandler);

		reqPromise
			.then((res) => {
				resolve(res);
			})
			.catch((err) => {
				reject(err);
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
	const err = error as { status?: string | number; message?: string };
	const status = err.status ? String(err.status) : 'unknown';
	const text = err.message || '';
	throw new Error(t('settings.providerErrors.apiError', { provider: providerName, status, text }));
}

/**
 * messages 배열에서 system role 메시지를 추출하여 하나의 문자열로 합칩니다.
 * Gemini/Anthropic 등 system instruction을 별도 필드로 전송하는 API에 사용합니다.
 */
export function extractSystemContent(messages: ChatMessage[]): string | undefined {
	const systemMsgs = messages.filter(m => m.role === 'system');
	if (systemMsgs.length === 0) return undefined;
	return systemMsgs.map(m => m.content).join('\n');
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
		if (buffer) {
			onLine(buffer);
		}
	} finally {
		reader.releaseLock();
	}
}