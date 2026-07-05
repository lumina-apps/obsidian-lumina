import { sanitizeDisplayContent } from "../../../shared/utils/llmTextSanitizer";

import { calculateEstimatedCost } from '../../../shared/pricing';
import {
	setMessageTokenUsage,
	syncMessageContent,
	setMessageStreaming,
	setMessageRagStep,
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
	resolvedModelId: string,
): void {
	// 토큰 사용량 기록
	if (tokenUsage) {
		const estimatedCost = calculateEstimatedCost(
			resolvedModelId,
			tokenUsage.inputTokens,
			tokenUsage.outputTokens,
		);
		setMessageTokenUsage(assistantId, {
			...tokenUsage,
			...(estimatedCost !== undefined ? { estimatedCost } : {}),
		});
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
