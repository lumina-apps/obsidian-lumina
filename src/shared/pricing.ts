/**
 * pricing.ts
 * 
 * 주요 모델의 토큰당 예상 단가(달러 $)를 계산하는 유틸리티
 * (1M 토큰당 가격 기준)
 */

interface ModelPrice {
	inputPer1M: number;
	outputPer1M: number;
}

// 2024년 중반 기준 대략적인 가격표 (단위: $)
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
	'gemini-2.0-flash-exp': { inputPer1M: 0.0, outputPer1M: 0.0 }, // Experimental은 무료인 경우가 많음
};

/**
 * 토큰 사용량에 대한 예상 비용을 계산합니다.
 * 알려지지 않은 모델이거나 비용을 계산할 수 없는 경우 undefined를 반환합니다.
 */
export function calculateEstimatedCost(modelId: string, inputTokens: number, outputTokens: number): number | undefined {
	if (!modelId) return undefined;
	
	// 모델 ID에서 prefix 매칭 혹은 정확한 매칭
	let matchedPrice: ModelPrice | undefined;

	// 정확한 매칭을 먼저 확인
	if (PRICING_TABLE[modelId]) {
		matchedPrice = PRICING_TABLE[modelId];
	} else {
		// prefix나 부분 매칭 (예: gpt-4o-2024-05-13 -> gpt-4o)
		for (const [key, price] of Object.entries(PRICING_TABLE)) {
			if (modelId.includes(key) || (key.startsWith('gpt-4o') && modelId.startsWith('gpt-4o'))) {
				// 가장 근접한 것을 찾기 위한 간단한 휴리스틱
				if (key === 'gpt-4o' && modelId.includes('mini')) {
					continue; // gpt-4o-mini는 gpt-4o에 매칭되지 않게
				}
				matchedPrice = price;
				break;
			}
		}
	}

	if (!matchedPrice) return undefined;

	const cost = (inputTokens / 1_000_000) * matchedPrice.inputPer1M + 
	             (outputTokens / 1_000_000) * matchedPrice.outputPer1M;
	
	return cost;
}
