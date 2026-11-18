import { Annotation } from '@codemirror/state';

/**
 * AI 편집(프롬프트 바 Diff 적용 등)으로 발생한 트랜잭션임을 표시하는 CM6 Annotation.
 * 자동완성 플러그인이 해당 변경에 반응하여 불필요한 재요청을 보내지 않도록 구분하는 용도이다.
 */
export const aiEditAnnotation = Annotation.define<boolean>();

/**
 * 두 문자열의 공통 접두·접미를 제외한 최소 변경 구간을 계산한다.
 * 동일 문자열이면 null을 반환한다.
 */
export function computeMinimalChange(
	baseText: string,
	newText: string,
): { from: number; to: number; insert: string } | null {
	if (baseText === newText) {
		return null;
	}

	let prefix = 0;
	const minLen = Math.min(baseText.length, newText.length);
	while (prefix < minLen && baseText.charCodeAt(prefix) === newText.charCodeAt(prefix)) {
		prefix++;
	}

	// UTF-16 서로게이트 페어 중간에서 분할되지 않도록 조정
	if (prefix > 0) {
		const prevCode = baseText.charCodeAt(prefix - 1);
		if (prevCode >= 0xd800 && prevCode <= 0xdbff) {
			prefix--;
		}
	}

	let suffix = 0;
	while (
		suffix < minLen - prefix &&
		baseText.charCodeAt(baseText.length - 1 - suffix) === newText.charCodeAt(newText.length - 1 - suffix)
	) {
		suffix++;
	}

	if (suffix > 0) {
		const nextCode = baseText.charCodeAt(baseText.length - suffix);
		if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
			suffix--;
		}
	}

	return {
		from: prefix,
		to: baseText.length - suffix,
		insert: newText.slice(prefix, newText.length - suffix),
	};
}

export interface ScopedMinimalChange {
	from: number;
	to: number;
	insert: string;
	isFullDoc: boolean;
}

/**
 * 기준 문서의 특정 범위([startOffset, endOffset]) 내에서 승인된 변경분을 추출하여
 * 현재 에디터 문서의 대상 시작 오프셋(currentTargetOffset) 기준 최소 변경 구간으로 변환한다.
 */
export function computeScopedMinimalChange(
	baseDoc: string,
	startOffset: number,
	endOffset: number,
	approvedDoc: string,
	currentTargetOffset: number,
): ScopedMinimalChange | null {
	const prefix = baseDoc.slice(0, startOffset);
	const suffix = baseDoc.slice(endOffset);

	if (
		approvedDoc.length >= prefix.length + suffix.length &&
		approvedDoc.startsWith(prefix) &&
		approvedDoc.endsWith(suffix)
	) {
		const originalTarget = baseDoc.slice(startOffset, endOffset);
		const approvedTarget = approvedDoc.slice(prefix.length, approvedDoc.length - suffix.length);
		const minimal = computeMinimalChange(originalTarget, approvedTarget);
		if (!minimal) {
			return null;
		}
		return {
			from: currentTargetOffset + minimal.from,
			to: currentTargetOffset + minimal.to,
			insert: minimal.insert,
			isFullDoc: false,
		};
	}

	// 대상 범위 바깥까지 변경된 예외 케이스 폴백 (baseDoc 전체 기준 오프셋)
	const fullMinimal = computeMinimalChange(baseDoc, approvedDoc);
	if (!fullMinimal) {
		return null;
	}
	return {
		...fullMinimal,
		isFullDoc: true,
	};
}
