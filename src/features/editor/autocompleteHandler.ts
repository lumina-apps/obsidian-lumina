import { sanitizeDisplayContent } from "../../shared/utils/llmTextSanitizer";
import { estimateTokens } from "../../shared/utils/tokenEstimator";
import type { ChatMessage, TokenUsage } from "../../shared/types/llm.types";

import { createProvider } from '../../core/llm-providers';
import {
	DEFAULT_AUTOCOMPLETE_CONTEXT_LENGTH,
	DEFAULT_AUTOCOMPLETE_PROMPT,
	DEFAULT_AUTOCOMPLETE_WAIT_TIME_MS,
} from '../../core/settings/defaultSettings';
import type LuminaPlugin from '../../main';
import { debugLogger } from '../../shared/debugLogger';

const PROMPT_LABEL_PREFIX_RE = /^(?:Context text|Output|Continuation)\s*:\s*/i;
const MARKDOWN_LINE_PREFIX_RE = /^\s*(?:[-*+]\s+|\d+\.\s+|#{1,6}\s+|>\s+)*/;
const REASONING_TAG_NAMES = ['think', 'thinking', 'thought', 'reasoning'] as const;
const AUTOCOMPLETE_MAX_OUTPUT_TOKENS = 600;
const SENTENCE_BOUNDARY_RE = /([.!?。！？])(?:\s+(?=\S)|(?=[가-힣A-Za-z0-9]))/g;

function stripClosedReasoningBlocks(normalized: string): string {
	let body = normalized;
	for (const tag of REASONING_TAG_NAMES) {
		const pattern = new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`, 'gi');
		body = body.replace(pattern, '');
	}
	return body;
}

/**
 * 첫 번째 완결 문장 끝 오프셋(구두점 포함)을 찾는다.
 * 목록 번호(1. )나 소수점(3.14), 짧은 약어는 오탐하지 않도록 최소 길이와 앞 문맥을 확인한다.
 */
function findFirstSentenceEndIndex(line: string): number {
	SENTENCE_BOUNDARY_RE.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = SENTENCE_BOUNDARY_RE.exec(line)) !== null) {
		const punctIdx = match.index;
		const before = line.slice(0, punctIdx);
		// 목록 번호("1.") 또는 짧은 약어("Dr.", "e.g.") 건너뛰기
		if (/^\s*\d+$/.test(before)) continue;
		if (before.trim().length < 8 && !/[。！？]/.test(match[1])) continue;
		if (/\b(?:Mr|Mrs|Ms|Dr|Prof|vs|etc|e\.g|i\.e)$/i.test(before)) continue;
		return punctIdx + 1;
	}
	return -1;
}

/**
 * 스트리밍 중인 누적 텍스트에서 <think> 등 사고 블록이 모두 닫힌 뒤
 * 실제 본문의 첫 번째 줄바꿈(\n) 또는 첫 번째 문장 완결이 감지되었는지 판별한다.
 */
export function hasCompletedFirstOutputLine(raw: string): boolean {
	if (!raw) return false;
	const normalized = raw
		.replace(/&lt;think&gt;/gi, '<think>')
		.replace(/&lt;\/think&gt;/gi, '</think>');
	const lower = normalized.toLowerCase();

	const trimmedStart = lower.trimStart();
	if (trimmedStart.startsWith('<') && !trimmedStart.includes('>') && trimmedStart.length < 16) {
		if (REASONING_TAG_NAMES.some((tag) => `<${tag}>`.startsWith(trimmedStart))) {
			return false;
		}
	}

	for (const tag of REASONING_TAG_NAMES) {
		const lastOpen = lower.lastIndexOf(`<${tag}>`);
		const lastClose = lower.lastIndexOf(`</${tag}>`);
		if (lastOpen !== -1 && lastOpen > lastClose) {
			return false;
		}
	}

	const body = stripClosedReasoningBlocks(normalized);
	const afterLeadingNewlines = body.replace(/^[\r\n]+/, '');
	const nlIdx = afterLeadingNewlines.indexOf('\n');
	if (nlIdx !== -1) {
		return afterLeadingNewlines.slice(0, nlIdx).trim().length > 0;
	}

	return findFirstSentenceEndIndex(afterLeadingNewlines) !== -1;
}

function normalizeLineForDuplicateCheck(line: string): string {
	return line
		.replace(MARKDOWN_LINE_PREFIX_RE, '')
		.replace(/\s+/g, ' ')
		.trim()
		.toLowerCase();
}

/**
 * 자동완성 응답에서 사고 태그·프롬프트 라벨·중복 접두/접미·기존 라인 복제를 제거하고
 * 커서 위치에 이어 붙일 단일 줄 제안을 반환한다. 유효한 새 내용이 없으면 null을 반환한다.
 */
export function postProcessAutocompleteSuggestion(
	rawSuggestion: string,
	contextText: string,
	suffixText?: string,
): string | null {
	if (!rawSuggestion) return null;

	// 1. <think> 등 사고 블록 및 특수 태그 제거
	const normalized = rawSuggestion
		.replace(/&lt;think&gt;/gi, '<think>')
		.replace(/&lt;\/think&gt;/gi, '</think>');
	const thinkEndIdx = normalized.toLowerCase().lastIndexOf('</think>');
	const afterThink = thinkEndIdx !== -1
		? normalized.slice(thinkEndIdx + '</think>'.length).trim()
		: normalized;

	let clean = sanitizeDisplayContent(afterThink);
	if (!clean) return null;

	// 2. 모델이 프롬프트 라벨을 에코한 경우 제거 후 첫 번째 비어 있지 않은 줄의 첫 문장만 추출
	clean = clean.replace(PROMPT_LABEL_PREFIX_RE, '');
	const firstLine = clean.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? '';
	if (!firstLine) return null;
	const firstSentenceEnd = findFirstSentenceEndIndex(firstLine);
	clean = firstSentenceEnd !== -1 ? firstLine.slice(0, firstSentenceEnd) : firstLine;

	// 3. 현재 줄 앞부분(커서 앞 같은 줄)을 모델이 다시 출력한 경우 중복 접두 제거
	const lastNl = Math.max(contextText.lastIndexOf('\n'), contextText.lastIndexOf('\r'));
	const currentLinePrefix = lastNl === -1 ? contextText : contextText.slice(lastNl + 1);
	const trimmedPrefix = currentLinePrefix.trimStart();
	const fullyTrimmedPrefix = currentLinePrefix.trim();

	if (currentLinePrefix.length > 0 && clean.startsWith(currentLinePrefix)) {
		clean = clean.slice(currentLinePrefix.length);
	} else if (trimmedPrefix.length > 0 && clean.startsWith(trimmedPrefix)) {
		clean = clean.slice(trimmedPrefix.length);
	} else if (fullyTrimmedPrefix.length >= 3 && clean.startsWith(fullyTrimmedPrefix)) {
		clean = clean.slice(fullyTrimmedPrefix.length);
	}

	if (!clean.trim()) return null;

	// 4. 커서 뒤 텍스트(suffixText)와 겹치거나 동일한 경우 제거
	if (suffixText && suffixText.trim().length > 0) {
		const suffixTrimmedStart = suffixText.trimStart();
		const suffixFirstLine = suffixTrimmedStart.split(/\r?\n/)[0]?.trim() ?? '';
		const cleanTrimmed = clean.trim();

		if (
			suffixFirstLine &&
			(cleanTrimmed === suffixFirstLine ||
				(cleanTrimmed.length >= 2 && suffixTrimmedStart.startsWith(cleanTrimmed)))
		) {
			return null;
		}

		if (suffixFirstLine.length >= 4 && clean.includes(suffixFirstLine)) {
			clean = clean.slice(0, clean.indexOf(suffixFirstLine));
		} else if (suffixFirstLine.length >= 2) {
			const maxOverlap = Math.min(clean.length, suffixFirstLine.length);
			for (let len = maxOverlap; len >= 2; len--) {
				if (clean.endsWith(suffixFirstLine.slice(0, len))) {
					clean = clean.slice(0, clean.length - len);
					break;
				}
			}
		}

		if (!clean.trim()) return null;
	}

	// 5. contextText 또는 suffixText 내 기존 줄을 그대로 복제한 경우 폐기
	const existingExactLines = new Set<string>();
	const existingNormalizedLines = new Set<string>();
	const collectLines = (src?: string) => {
		if (!src) return;
		for (const line of src.split(/\r?\n/)) {
			const trimmed = line.trim();
			if (trimmed) {
				existingExactLines.add(trimmed);
				const norm = normalizeLineForDuplicateCheck(trimmed);
				if (norm) existingNormalizedLines.add(norm);
			}
		}
	};
	collectLines(contextText);
	collectLines(suffixText);

	const cleanTrimmed = clean.trim();
	const normClean = normalizeLineForDuplicateCheck(cleanTrimmed);
	const normCompletedLine = normalizeLineForDuplicateCheck(currentLinePrefix + clean);

	if (
		existingExactLines.has(cleanTrimmed) ||
		(normCompletedLine.length >= 2 && existingNormalizedLines.has(normCompletedLine)) ||
		(normClean.length >= 3 && existingNormalizedLines.has(normClean))
	) {
		return null;
	}

	// 6. 앞뒤 공백 보정: 커서 직전이 공백이면 선행 공백 제거, 영숫자 경계면 공백 삽입
	if (/\s$/.test(contextText)) {
		clean = clean.replace(/^\s+/, '');
	} else if (/[a-zA-Z0-9]$/.test(contextText) && /^[a-zA-Z0-9]/.test(clean)) {
		clean = ' ' + clean;
	}

	return clean.trim() ? clean : null;
}

export class AutocompleteHandler {
	private plugin: LuminaPlugin;
	private abortController: AbortController | null = null;

	constructor(plugin: LuminaPlugin) {
		this.plugin = plugin;
	}

	getContextLength(): number {
		const raw = this.plugin.settings?.chat?.autocompleteContextLength;
		if (typeof raw !== 'number' || isNaN(raw) || raw <= 0) {
			return DEFAULT_AUTOCOMPLETE_CONTEXT_LENGTH;
		}
		return Math.max(100, Math.floor(raw));
	}

	getWaitTimeMs(): number {
		const raw = this.plugin.settings?.chat?.autocompleteWaitTimeMs;
		if (typeof raw !== 'number' || isNaN(raw) || raw <= 0) {
			return DEFAULT_AUTOCOMPLETE_WAIT_TIME_MS;
		}
		return Math.max(100, Math.floor(raw));
	}

	async fetchSuggestion(contextText: string, suffixText?: string): Promise<string | null> {
		if (!this.plugin.settings.chat.enableAutocomplete) return null;
		const { taskProviderId, taskModelId, providers } = this.plugin.settings.connections;
		if (!taskProviderId || !taskModelId) return null;

		const providerConfig = providers.find(p => p.id === taskProviderId);
		if (!providerConfig || !providerConfig.isVerified) return null;

		if (!contextText.trim()) return null;

		const customPrompt = this.plugin.settings.chat.autocompletePrompt?.trim();
		const instruction = customPrompt || DEFAULT_AUTOCOMPLETE_PROMPT;
		const isCustomInstruction = Boolean(customPrompt && customPrompt !== DEFAULT_AUTOCOMPLETE_PROMPT);

		const systemPrompt = isCustomInstruction
			? `${DEFAULT_AUTOCOMPLETE_PROMPT}\n\nAdditional user instructions (MUST follow strictly):\n${instruction}`
			: instruction;

		// 커서 뒤 텍스트(suffixText)는 프롬프트 앞쪽에 간결히 참고용으로만 제시하고,
		// 맨 끝은 항상 커서 앞 contextText로 끝나게 하여 소형/추론 모델의 과도한 검증 루프와 복제를 함께 방지한다.
		const hasSuffix = Boolean(suffixText && suffixText.trim().length > 0);
		const suffixBlock = hasSuffix
			? `[Text after cursor]:\n${suffixText!.trim()}\n\n`
			: '';

		const userPrompt = isCustomInstruction
			? `${suffixBlock}[Instruction reminder: ${instruction}. Output ONLY the raw continuation text.]\n\nContext text:\n${contextText}`
			: `${suffixBlock}Context text:\n${contextText}`;

		const llmMessages: ChatMessage[] = [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt },
		];

		if (this.abortController) {
			this.abortController.abort();
		}
		this.abortController = new AbortController();
		const externalSignal = this.abortController.signal;

		const startTime = Date.now();
		const estimatedInputTokens = debugLogger.isEnabled
			? estimateTokens(systemPrompt) + estimateTokens(userPrompt)
			: undefined;

		let usedStreaming = false;
		try {
			const provider = createProvider(providerConfig);
			const chatOptions = {
				model: taskModelId,
				temperature: 0.2,
				// 추론형(Thinking) 모델이 사고 블록 도중 length로 잘리지 않도록 충분한 상한(1500)을 부여하되,
				// 스트리밍 중 본문 첫 줄이 완성되는 즉시 조기 중단(early stop)하여 일반 모델의 불필요한 장문 생성도 막는다.
				maxOutputTokens: AUTOCOMPLETE_MAX_OUTPUT_TOKENS,
				signal: externalSignal,
				ttftTimeoutMs: 10000,
				interTokenTimeoutMs: 5000,
			};

			let rawResponse = '';
			let usage: TokenUsage | undefined;
			let finishReason: string | undefined;

			if (typeof provider.stream === 'function') {
				usedStreaming = true;
				const streamCtrl = new AbortController();
				let earlyStopped = false;
				const onExternalAbort = () => streamCtrl.abort();
				if (externalSignal.aborted) {
					streamCtrl.abort();
				} else {
					externalSignal.addEventListener('abort', onExternalAbort, { once: true });
				}

				let chunkCount = 0;
				try {
					const streamRes = await provider.stream(
						llmMessages,
						{ ...chatOptions, signal: streamCtrl.signal },
						(chunk) => {
							if (!chunk) return;
							rawResponse += chunk;
							if (chunk.replace(/\r/g, '')) {
								chunkCount++;
							}
							if (hasCompletedFirstOutputLine(rawResponse)) {
								earlyStopped = true;
								streamCtrl.abort();
							}
						},
					);
					usage = streamRes?.usage;
					finishReason = streamRes?.finishReason;
				} catch (streamErr) {
					if (!earlyStopped || externalSignal.aborted) {
						throw streamErr;
					}
					finishReason = 'early_stop_first_line';
				} finally {
					externalSignal.removeEventListener('abort', onExternalAbort);
				}

				if (externalSignal.aborted) {
					return null;
				}

				// 스트리밍 청크가 전혀 오지 않은 프로바이더는 논스트리밍 chat()으로 폴백
				if (chunkCount === 0 && !earlyStopped) {
					usedStreaming = false;
					const response = await provider.chat(llmMessages, chatOptions);
					rawResponse = response.content;
					usage = response.usage;
					finishReason = response.finishReason;
				}
			} else {
				const response = await provider.chat(llmMessages, chatOptions);
				rawResponse = response.content;
				usage = response.usage;
				finishReason = response.finishReason;
			}

			const cleanSuggestion = postProcessAutocompleteSuggestion(rawResponse, contextText, suffixText);

			// 키 입력 중 취소(Abort)되지 않고 완료된 요청만 쌍으로 기록하여 링 버퍼 오염 및 미완결 로그 방지
			const requestId = debugLogger.logRequest({
				provider: providerConfig.type,
				model: taskModelId,
				temperature: 0.2,
				maxTokens: AUTOCOMPLETE_MAX_OUTPUT_TOKENS,
				stream: usedStreaming,
				systemPrompt,
				messages: llmMessages.map(m => ({ role: m.role, content: m.content as string })),
				...(estimatedInputTokens !== undefined ? { estimatedInputTokens } : {}),
			});
			debugLogger.logResponse(requestId, {
				model: taskModelId,
				content: cleanSuggestion || '(empty)',
				durationMs: Date.now() - startTime,
				usage,
				...(finishReason ? { stopReason: finishReason } : {}),
			});

			return cleanSuggestion || null;
		} catch (error) {
			if (externalSignal.aborted || (error instanceof Error && error.name === 'AbortError')) {
				return null;
			}
			const requestId = debugLogger.logRequest({
				provider: providerConfig.type,
				model: taskModelId,
				temperature: 0.2,
				maxTokens: AUTOCOMPLETE_MAX_OUTPUT_TOKENS,
				stream: usedStreaming,
				systemPrompt,
				messages: llmMessages.map(m => ({ role: m.role, content: m.content as string })),
				...(estimatedInputTokens !== undefined ? { estimatedInputTokens } : {}),
			});
			debugLogger.logResponse(requestId, {
				model: taskModelId,
				content: `❌ [Error] ${error instanceof Error ? error.message : String(error)}`,
				durationMs: Date.now() - startTime,
				stopReason: 'error',
			});
			debugLogger.logError('llm', error instanceof Error ? error : new Error(String(error)));
			return null;
		}
	}
}
