/**
 * CJK 문자 (한글, 한자, 히라가나, 가타카나, CJK 기호/문장부호, 전각 기호 등) 정규식
 */
const CJK_REGEX = /[\u1100-\u11FF\u3000-\u303F\u3040-\u309F\u30A0-\u30FF\u3130-\u318F\u4E00-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/g;

/**
 * 프로바이더별 CJK(한글/한자/일본어) 글자당 추정 토큰 가중치를 반환합니다.
 * - OpenAI(`o200k_base`) 및 Google Gemini(SentencePiece 256k) 계열: ~0.95 (다국어 어휘 확장 반영)
 * - Anthropic Claude 및 로컬 모델/미지정(보수적 안전 상한): 1.5
 */
export function getCjkTokenWeight(providerType?: string): number {
	if (!providerType) return 1.5;
	const normalized = providerType.toLowerCase();
	if (
		normalized === 'openai' ||
		normalized === 'cli-codex' ||
		normalized === 'google' ||
		normalized === 'cli-antigravity'
	) {
		return 0.95;
	}
	return 1.5;
}

/**
 * 텍스트의 대략적인 토큰 길이를 추정합니다.
 * - 한글/CJK 문자는 프로바이더에 따라 1글자당 0.95(OpenAI/Google) 또는 1.5(Anthropic/로컬/기본) 토큰
 * - 영문, 숫자, 일반 기호 등은 약 4글자당 1 토큰 (0.25)
 *
 * `text.match(/.../g)` 대신 `exec` 루프를 사용하여 거대 텍스트나 실시간 타이핑 시 불필요한 메모리 할당(GC)을 최소화합니다.
 */
export function estimateTokens(text: string, providerType?: string): number {
	if (!text) return 0;

	CJK_REGEX.lastIndex = 0;
	let cjkCount = 0;
	while (CJK_REGEX.exec(text) !== null) {
		cjkCount++;
	}

	const cjkWeight = getCjkTokenWeight(providerType);
	const otherCount = text.length - cjkCount;
	const tokens = (cjkCount * cjkWeight) + (otherCount * 0.25);
	return Math.ceil(tokens);
}

