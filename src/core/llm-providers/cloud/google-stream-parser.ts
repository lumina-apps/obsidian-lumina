/**
 * google-stream-parser.ts
 * Gemini JSON 스트림 응답을 파싱하여 청크 단위로 전달
 */
import type { GeminiStreamChunk } from './google.types';
import { debugLogger } from '../../../shared/debugLogger';

/**
 * Gemini stream response body를 읽어 JSON 객체 단위로 onChunk 콜백 호출.
 * Gemini 스트림은 각 청크가 `[...]` 배열에 감싸진 JSON 라인으로 전달되며,
 * 파서는 brace depth 카운팅으로 완전한 JSON 객체를 찾아낸다.
 */
export async function readGeminiStreamChunks(
	response: Response,
	signal: AbortSignal | undefined,
	onChunk: (chunk: GeminiStreamChunk) => void
): Promise<void> {
	const reader = response.body?.getReader();
	if (!reader) {
		throw new Error('Response body is not readable');
	}
	const decoder = new TextDecoder('utf-8');
	let buffer = '';
	let braceCount = 0;
	let inString = false;
	let escape = false;
	let objectStart = -1;

	try {
		while (true) {
			if (signal?.aborted) {
				await reader.cancel();
				break;
			}
			const { done, value } = await reader.read();
			if (done) break;

			buffer += decoder.decode(value, { stream: true });

			let i = 0;
			while (i < buffer.length) {
				const char = buffer[i];

				if (inString) {
					if (escape) {
						escape = false;
					} else if (char === '\\') {
						escape = true;
					} else if (char === '"') {
						inString = false;
					}
				} else {
					if (char === '"') {
						inString = true;
					} else if (char === '{') {
						if (braceCount === 0) {
							objectStart = i;
						}
						braceCount++;
					} else if (char === '}') {
						braceCount--;
						if (braceCount === 0 && objectStart !== -1) {
							const objStr = buffer.substring(objectStart, i + 1);
							try {
								const chunk = JSON.parse(objStr) as GeminiStreamChunk;
								onChunk(chunk);
							} catch (e) {
								debugLogger.logError('Gemini Stream Parse', `Failed to parse chunk: "${objStr}". Error: ${e instanceof Error ? e.message : String(e)}`);
							}
							buffer = buffer.substring(i + 1);
							i = -1;
							objectStart = -1;
						}
					}
				}
				i++;
			}
		}
	} finally {
		reader.releaseLock();
	}
}