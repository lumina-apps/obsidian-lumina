import { t } from '../../../shared/locales/helpers';
import type { UIChatMessage } from '../../../shared/types/chat.types';
import type { LLMProviderConfig } from '../../../shared/types/settings.types';
import type { LuminaSettings } from '../../../core/settings/settings.types';
import { debugLogger } from '../../../shared/debugLogger';
import { sanitizeDisplayContent } from '../../../shared/utils/llmTextSanitizer';

/** 안전한 세션 제목 정제 (Windows 금지문자, 제어문자 및 말미 마침표/공백 제거) */
export function sanitizeSafeTitle(title: string): string {
	const stripped = title
		.replace(/[\s\p{Cc}]+/gu, ' ')
		.replace(/[\\/:*?"<>|]/g, '_')
		.replace(/[.\s]+$/, '')
		.trim();
	return stripped || t('chat.newChat');
}

/** 메시지 목록으로부터 대화 제목을 생성 (첫 번째 사용자 메시지 기준 최대 40자) */
export function generateTitle(messages: UIChatMessage[]): string {
	const first = messages.find(m => m.role === 'user');
	if (!first) return t('chat.newChat');
	const text = first.content?.replace(/[\r\n\t]+/g, ' ').trim();
	if (!text && first.attachments && first.attachments.length > 0) {
		return first.attachments[0].name;
	}
	if (!text) return t('chat.newChat');
	return text.slice(0, 40) + (text.length > 40 ? '…' : '');
}

/** LLM을 활용하여 대화 내용을 3~5단어로 요약한 제목 생성 (실패 시 휴리스틱 generateTitle로 폴백) */
export async function generateTitleWithLLM(
	messages: UIChatMessage[],
	providerConfig: LLMProviderConfig,
	modelId: string,
	_settings: LuminaSettings
): Promise<string> {
	const first = messages.find(m => m.role === 'user');
	if (!first || !first.content.trim()) return t('chat.newChat');

	// Prompt Injection 방지: 입력을 200자로 제한하고 큰따옴표 이스케이프
	const safeContent = first.content
		.slice(0, 200)
		.replace(/"/g, '\\"');
	const prompt = `Summarize the following user message into a very short title in 3-5 words. Output only the title text, no quotes, no explanations.\n\nUser message: "${safeContent}"`;

	try {
		const { createProvider } = await import('../../../core/llm-providers/index');
		const provider = createProvider(providerConfig);
		const response = await provider.chat(
			[
				{ role: 'system', content: 'You are a title generator. Reply with ONLY the title in 3-5 words, in the same language as the user\'s message. No explanations, no thinking tags, no markdown. Just the title text.' },
				{ role: 'user', content: prompt }
			],
			{
				model: modelId,
				temperature: 0,
				maxOutputTokens: 2000
			}
		);
		// reasoning 모델 대응: </think> 이후 텍스트만 추출
		let rawContent = response.content;
		const thinkEndIdx = rawContent.lastIndexOf('</think>');
		if (thinkEndIdx !== -1) {
			rawContent = rawContent.substring(thinkEndIdx + 8).trim();
		}
		const title = sanitizeDisplayContent(rawContent).replace(/["']/g, '').trim();
		return title || generateTitle(messages);
	} catch (e) {
		debugLogger.logWarn('history', `Failed to generate title with LLM, falling back to text extraction: ${e}`);
		return generateTitle(messages);
	}
}
