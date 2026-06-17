/**
 * 멀티모달 이미지를 마지막 user 메시지에 주입하는 헬퍼.
 */

import type { ChatMessage, MultiModalContent } from '../../../shared/types/llm.types';

/**
 * 멀티모달 이미지를 마지막 user 메시지에 주입한다.
 */
export function injectMultimodalImages(llmMessages: ChatMessage[], imageUrls: string[]): ChatMessage[] {
	const lastMsg = llmMessages[llmMessages.length - 1];
	if (!lastMsg || lastMsg.role !== 'user') return llmMessages;

	const multiContent: MultiModalContent[] = [
		{ type: 'text', text: lastMsg.content as string },
		...imageUrls.map(url => ({ type: 'image_url' as const, image_url: { url } })),
	];
	lastMsg.content = multiContent;
	return llmMessages;
}