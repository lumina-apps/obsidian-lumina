import { sanitizeDisplayContent } from "../../shared/utils/llmTextSanitizer";

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

		const instruction = this.plugin.settings.chat.autocompletePrompt?.trim() || DEFAULT_AUTOCOMPLETE_PROMPT;
		const prompt = `${instruction}\n\nContext text:\n${contextText}`;

		if (this.abortController) {
			this.abortController.abort();
		}
		this.abortController = new AbortController();

		try {
			const provider = createProvider(providerConfig);
			
			// We only want a very short completion
			const response = await provider.chat([{ role: 'user', content: prompt }], {
				model: taskModelId,
				temperature: 0.2,
				maxOutputTokens: 50,
				signal: this.abortController.signal,
				ttftTimeoutMs: 10000,
				interTokenTimeoutMs: 5000,
			});

			const suggestion = response.content;
			
			// 간단한 후처리: 
			// LLM이 생각 과정(think tag)을 포함한 경우 제거
			let cleanSuggestion = sanitizeDisplayContent(suggestion);
			
			// 문맥 끝에 맞춰 띄어쓰기 조절
			if (cleanSuggestion && !contextText.endsWith(' ') && !contextText.endsWith('\n')) {
				cleanSuggestion = ' ' + cleanSuggestion;
			}

			return cleanSuggestion || null;
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				// Ignored
				return null;
			}
			debugLogger.logError('llm', error as Error);
			return null;
		}
	}
}
