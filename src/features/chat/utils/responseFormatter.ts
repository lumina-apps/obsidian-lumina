import { sanitizeDisplayContent, extractThinkBlocks } from "../../../shared/utils/llmTextSanitizer";

import {
	setMessageTokenUsage,
	syncMessageContent,
	setMessageStreaming,
	setMessageRagStep,
	appendThinking,
} from '../../../core/store/chatStore';
import type { TokenUsage } from '../../../shared/types/llm.types';
import { t } from '../../../shared/locales/helpers';

/**
 * LLM 응답 후처리: 토큰 사용량 기록, 빈 응답/토큰 한도 처리, 스트리밍 완료 표시.
 */
export function handleLlmResponse(
	assistantId: string,
	fullResponse: string,
	tokenUsage: TokenUsage | undefined,
	hasTokenLimitBeenHit: boolean,
): void {
	// 토큰 사용량 기록
	if (tokenUsage) {
		setMessageTokenUsage(assistantId, tokenUsage);
	}

	// <think> 블록을 추출하여 message.thinking에 보존 (스트리밍 종료 후에도 UI에 표시)
	const thinkBlocks = extractThinkBlocks(fullResponse);
	if (thinkBlocks.length > 0) {
		appendThinking(assistantId, thinkBlocks.join('\n\n'));
	}

	// 특수 태그(<think>, <tool_call>, <|mask_start|> 등) 제거
	let finalContent = sanitizeDisplayContent(fullResponse);

	// 빈 응답 / 토큰 한도 처리
	if (!finalContent) {
		finalContent = hasTokenLimitBeenHit
			? t('uiMessages.emptyResponseTokenLimit')
			: t('settings.chat.emptyResponseFallback');
	} else if (hasTokenLimitBeenHit) {
		finalContent += '\n\n' + t('uiMessages.tokenLimitHitWarning');
	}
	
	syncMessageContent(assistantId, finalContent);
	setMessageStreaming(assistantId, false);
	setMessageRagStep(assistantId, null);
}
