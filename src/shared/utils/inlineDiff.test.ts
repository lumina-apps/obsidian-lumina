/**
 * inlineDiff.test.ts
 * CJK 및 다국어 인라인(grapheme 단위) diff 계산 로직 검증
 */
import { describe, it, expect } from 'vitest';
import { computeInlineDiff, segmentGraphemes, segmentWords, splitDiffLines } from './inlineDiff';

describe('segmentWords', () => {
	it('토큰을 join하면 원문이 복원된다', () => {
		const text = '오늘 사과를 먹었다, ok!';
		expect(segmentWords(text).join('')).toBe(text);
		expect(segmentWords('')).toEqual([]);
	});
});

describe('segmentGraphemes', () => {
	it('빈 문자열은 빈 배열을 반환한다', () => {
		expect(segmentGraphemes('')).toEqual([]);
	});

	it('ZWJ 이모지를 하나의 grapheme으로 유지한다', () => {
		const segments = segmentGraphemes('a👨‍👩‍👧‍👦b');
		expect(segments).toEqual(['a', '👨‍👩‍👧‍👦', 'b']);
	});

	it('NFD 한글 자모 조합도 하나의 grapheme으로 처리한다', () => {
		const nfdHangul = '한'.normalize('NFD');
		const segments = segmentGraphemes(nfdHangul);
		expect(segments).toHaveLength(1);
		expect(segments[0]).toBe(nfdHangul);
	});
});

describe('splitDiffLines', () => {
	it('CRLF와 후행 개행을 정규화하여 줄 배열을 반환한다', () => {
		expect(splitDiffLines('첫째 줄\r\n둘째 줄\r\n')).toEqual(['첫째 줄', '둘째 줄']);
		expect(splitDiffLines('하나\n')).toEqual(['하나']);
		expect(splitDiffLines('')).toEqual([]);
	});
});

describe('computeInlineDiff', () => {
	it('한국어 문장에서 변경된 글자만 changed로 표시한다', () => {
		const result = computeInlineDiff('오늘은 날씨가 좋다\n', '오늘은 날씨가 나쁘다\n');

		expect(result.removed[0]).toEqual([
			{ text: '오늘은 날씨가 ', changed: false },
			{ text: '좋', changed: true },
			{ text: '다', changed: false },
		]);
		expect(result.added[0]).toEqual([
			{ text: '오늘은 날씨가 ', changed: false },
			{ text: '나쁘', changed: true },
			{ text: '다', changed: false },
		]);
	});

	it('일본어 문장에서 한 글자 수정/삽입/삭제를 정확히 찾는다', () => {
		const result = computeInlineDiff('今日は天気が良いですね\n', '今日は天気が悪いですね\n');
		expect(result.removed[0]).toEqual([
			{ text: '今日は天気が', changed: false },
			{ text: '良', changed: true },
			{ text: 'いですね', changed: false },
		]);
		expect(result.added[0]).toEqual([
			{ text: '今日は天気が', changed: false },
			{ text: '悪', changed: true },
			{ text: 'いですね', changed: false },
		]);
	});

	it('중국어 문장에서 한 글자 삽입 시 추가된 글자만 강조한다', () => {
		const result = computeInlineDiff('今天天气好\n', '今天天气很好\n');
		expect(result.removed[0]).toBeNull();
		expect(result.added[0]).toEqual([
			{ text: '今天天气', changed: false },
			{ text: '很', changed: true },
			{ text: '好', changed: false },
		]);
	});

	it('영문 단어 중간 변경은 파편화를 막기 위해 단어 전체로 확장한다', () => {
		const result = computeInlineDiff('I have a cat here\n', 'I have a cut here\n');
		expect(result.removed[0]).toEqual([
			{ text: 'I have a ', changed: false },
			{ text: 'cat', changed: true },
			{ text: ' here', changed: false },
		]);
		expect(result.added[0]).toEqual([
			{ text: 'I have a ', changed: false },
			{ text: 'cut', changed: true },
			{ text: ' here', changed: false },
		]);
	});

	it('한글 단어 치환 시 조사는 유지하고 치환된 단어만 한 덩어리로 강조한다', () => {
		const result = computeInlineDiff('오늘 사과를 먹었다\n', '오늘 바나나를 먹었다\n');
		expect(result.removed[0]).toEqual([
			{ text: '오늘 ', changed: false },
			{ text: '사과', changed: true },
			{ text: '를 먹었다', changed: false },
		]);
		expect(result.added[0]).toEqual([
			{ text: '오늘 ', changed: false },
			{ text: '바나나', changed: true },
			{ text: '를 먹었다', changed: false },
		]);
	});

	it('짝이 맞는 삭제/추가 줄을 한 줄(removed → added 순)로 병합한다', () => {
		const result = computeInlineDiff('오늘 사과를 먹었다\n', '오늘 바나나를 먹었다\n');
		expect(result.merged).toEqual([
			{
				removedIdx: 0,
				addedIdx: 0,
				segments: [
					{ text: '오늘 ', kind: 'equal' },
					{ text: '사과', kind: 'removed' },
					{ text: '바나나', kind: 'added' },
					{ text: '를 먹었다', kind: 'equal' },
				],
			},
		]);
	});

	it('삽입만 있는 줄도 병합되며 삭제 조각 없이 추가 조각만 포함한다', () => {
		const result = computeInlineDiff('今天天气好\n', '今天天气很好\n');
		expect(result.merged).toHaveLength(1);
		const kinds = result.merged[0].segments.map((s) => s.kind);
		expect(kinds).not.toContain('removed');
		expect(result.merged[0].segments.filter((s) => s.kind === 'added').map((s) => s.text)).toEqual(['很']);
	});

	it('인라인 하이라이트가 생략된 줄은 병합하지 않는다', () => {
		const result = computeInlineDiff('완전히 다른 첫 문장\n', '전혀 상관없는 새 내용\n');
		expect(result.merged).toEqual([]);
	});

	it('줄 수가 다른 블록에서 유사한 줄만 매칭하고 짝이 없는 줄은 null로 둔다', () => {
		const removed = '첫 번째 문장입니다\n완전히 삭제될 줄\n세 번째 문장입니다\n';
		const added = '첫 번째 문장이에요\n세 번째 문장입니다\n';
		const result = computeInlineDiff(removed, added);

		expect(result.removed[0]).not.toBeNull();
		expect(result.removed[1]).toBeNull();
		expect(result.removed[2]).toBeNull(); // 세 번째 문장은 동일하므로 인라인 변경 없음
		expect(result.added[0]).not.toBeNull();
		expect(result.added[1]).toBeNull();
	});

	it('변경 비율이 임계값을 넘는 전혀 다른 문장은 null로 폴백한다', () => {
		const result = computeInlineDiff('완전히 다른 첫 문장\n', '전혀 상관없는 새 내용\n');
		expect(result.removed[0]).toBeNull();
		expect(result.added[0]).toBeNull();
	});

	it('길이가 상한(2000자)을 넘는 줄은 성능 보호를 위해 null로 폴백한다', () => {
		const longA = '가'.repeat(2001);
		const longB = `${'가'.repeat(2000)}나`;
		const result = computeInlineDiff(longA, longB);
		expect(result.removed[0]).toBeNull();
		expect(result.added[0]).toBeNull();
	});

	it('빈 문자열 입력에 대해 안전하게 빈 결과를 반환한다', () => {
		const result = computeInlineDiff('', '새 줄\n');
		expect(result.removed).toEqual([]);
		expect(result.added).toEqual([null]);
	});
});
