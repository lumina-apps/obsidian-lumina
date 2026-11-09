import { sanitizeDisplayContent } from "../../shared/utils/llmTextSanitizer";
import { estimateTokens } from "../../shared/utils/tokenEstimator";
import type { ChatMessage } from "../../shared/types/llm.types";

import { createProvider } from '../../core/llm-providers';
import {
	DEFAULT_AUTOCOMPLETE_CONTEXT_LENGTH,
	DEFAULT_AUTOCOMPLETE_PROMPT,
	DEFAULT_AUTOCOMPLETE_WAIT_TIME_MS,
} from '../../core/settings/defaultSettings';
import type LuminaPlugin from '../../main';
import { debugLogger } from '../../shared/debugLogger';

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

	async fetchSuggestion(contextText: string): Promise<string | null> {
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

		const userPrompt = isCustomInstruction
			? `Context text:\n${contextText}\n\n[Instruction reminder: ${instruction}. Output ONLY the raw continuation text.]`
			: `Context text:\n${contextText}`;

		const llmMessages: ChatMessage[] = [
			{ role: 'system', content: systemPrompt },
			{ role: 'user', content: userPrompt },
		];

		if (this.abortController) {
			this.abortController.abort();
		}
		this.abortController = new AbortController();

		const startTime = Date.now();
		const estimatedInputTokens = estimateTokens(systemPrompt) + estimateTokens(userPrompt);
		const requestId = debugLogger.logRequest({
			provider: providerConfig.type,
			model: taskModelId,
			temperature: 0.2,
			maxTokens: 500,
			stream: false,
			systemPrompt,
			messages: llmMessages.map(m => ({ role: m.role, content: m.content as string })),
			estimatedInputTokens,
		});

		try {
			const provider = createProvider(providerConfig);
			
			// 추론형(Thinking) 모델이 내부 사고 토큰으로 출력 한도를 소진하지 않도록 여유 토큰(500) 부여
			const response = await provider.chat(llmMessages, {
				model: taskModelId,
				temperature: 0.2,
				maxOutputTokens: 500,
				signal: this.abortController.signal,
				ttftTimeoutMs: 10000,
				interTokenTimeoutMs: 5000,
			});

			const suggestion = response.content;
			
			// 간단한 후처리: 
			// LLM이 생각 과정(think tag)을 포함한 경우 제거
			let rawContent = suggestion;
			const thinkEndIdx = rawContent.lastIndexOf('</think>');
			if (thinkEndIdx !== -1) {
				rawContent = rawContent.substring(thinkEndIdx + 8).trim();
			}
			let cleanSuggestion = sanitizeDisplayContent(rawContent);
			
			// 문맥 끝에 맞춰 띄어쓰기 조절
			if (cleanSuggestion && !contextText.endsWith(' ') && !contextText.endsWith('\n')) {
				cleanSuggestion = ' ' + cleanSuggestion;
			}

			debugLogger.logResponse(requestId, {
				model: taskModelId,
				content: cleanSuggestion || '(empty)',
				durationMs: Date.now() - startTime,
				usage: response.usage,
			});

			return cleanSuggestion || null;
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				debugLogger.logDebug('autocomplete', 'Autocomplete request aborted by newer input');
				return null;
			}
			debugLogger.logError('llm', error as Error);
			return null;
		}
	}
}
