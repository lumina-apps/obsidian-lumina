/**
 * pricing.ts
 * 
 * 1M 토큰당 가격을 기준으로 LLM 모델의 예상 비용을 계산.
 */

interface ModelPrice {
	inputPer1M: number;
	outputPer1M: number;
}

// 2024년 중반 기준 가격표 (단위: $)
const PRICING_TABLE: Record<string, ModelPrice> = {
	// OpenAI
	'gpt-4o': { inputPer1M: 5.0, outputPer1M: 15.0 },
	'gpt-4o-mini': { inputPer1M: 0.15, outputPer1M: 0.60 },
	'gpt-4-turbo': { inputPer1M: 10.0, outputPer1M: 30.0 },
	
	// Anthropic
	'claude-3-5-sonnet-latest': { inputPer1M: 3.0, outputPer1M: 15.0 },
	'claude-3-5-haiku-latest': { inputPer1M: 0.25, outputPer1M: 1.25 },
	'claude-3-opus-latest': { inputPer1M: 15.0, outputPer1M: 75.0 },
	
	// Google
	'gemini-1.5-pro': { inputPer1M: 3.5, outputPer1M: 10.5 },
	'gemini-1.5-flash': { inputPer1M: 0.075, outputPer1M: 0.3 },
	'gemini-2.0-flash-exp': { inputPer1M: 0.0, outputPer1M: 0.0 },
};

/** 토큰 사용량에 대한 예상 비용을 $로 반환. 알 수 없는 모델이면 undefined */
export function calculateEstimatedCost(modelId: string, inputTokens: number, outputTokens: number): number | undefined {
	if (!modelId) return undefined;
	
	let matchedPrice: ModelPrice | undefined;

	// 정확 매칭 우선
	if (PRICING_TABLE[modelId]) {
		matchedPrice = PRICING_TABLE[modelId];
	} else {
		// 부분 매칭 (예: gpt-4o-2024-05-13 → gpt-4o)
		for (const [key, price] of Object.entries(PRICING_TABLE)) {
			if (modelId.includes(key) || (key.startsWith('gpt-4o') && modelId.startsWith('gpt-4o'))) {
				if (key === 'gpt-4o' && modelId.includes('mini')) {
					continue;
				}
				matchedPrice = price;
				break;
			}
		}
	}

	if (!matchedPrice) return undefined;

	return (inputTokens / 1_000_000) * matchedPrice.inputPer1M + 
	       (outputTokens / 1_000_000) * matchedPrice.outputPer1M;
}
