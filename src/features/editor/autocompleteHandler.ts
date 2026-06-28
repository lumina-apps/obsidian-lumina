import { createProvider } from '../../core/llm-providers';
import type LuminaPlugin from '../../main';
import { debugLogger } from '../../shared/debugLogger';

export class AutocompleteHandler {
	private plugin: LuminaPlugin;
	private abortController: AbortController | null = null;

	constructor(plugin: LuminaPlugin) {
		this.plugin = plugin;
	}

	async fetchSuggestion(contextText: string): Promise<string | null> {
		if (!this.plugin.settings.chat.enableAutocomplete) return null;
		const { taskProviderId, taskModelId, providers } = this.plugin.settings.connections;
		if (!taskProviderId || !taskModelId) return null;

		const providerConfig = providers.find(p => p.id === taskProviderId);
		if (!providerConfig || !providerConfig.isVerified) return null;

		if (!contextText.trim()) return null;

		const prompt = `You are an inline autocomplete AI for a markdown editor. Based on the following text, provide only the exact continuation that should logically follow the cursor. Do not output any explanation, markdown blocks, or surrounding quotes. Only output the raw text to be appended. If the context ends mid-sentence, finish the sentence. If it ends at a sentence, provide the next logical sentence.\n\nContext text:\n${contextText}`;

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
				maxOutputTokens: 50
			});

			const suggestion = response.content;
			
			// 간단한 후처리: 
			// LLM이 생각 과정(think tag)을 포함한 경우 제거
			let cleanSuggestion = suggestion.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
			
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
