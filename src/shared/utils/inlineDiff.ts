import { diffArrays } from 'diff';

/** 인라인 diff의 개별 텍스트 조각 */
export interface InlineSegment {
	text: string;
	changed: boolean;
}

/** 삭제/추가 블록 쌍에 대한 줄별 인라인 diff 결과 */
export interface InlineDiffResult {
	/** 삭제 블록의 줄별 세그먼트 (인라인 하이라이트 생략 시 null) */
	removed: (InlineSegment[] | null)[];
	/** 추가 블록의 줄별 세그먼트 (인라인 하이라이트 생략 시 null) */
	added: (InlineSegment[] | null)[];
	/** 삭제 줄과 추가 줄을 한 줄로 병합할 수 있는 쌍 (removedIdx 오름차순) */
	merged: MergedLine[];
}

/** 병합된 한 줄의 개별 조각 (equal: 공통, removed: 삭제, added: 추가) */
export interface MergedSegment {
	text: string;
	kind: 'equal' | 'removed' | 'added';
}

/** 삭제 줄과 추가 줄을 하나로 합친 인라인 표시용 줄 */
export interface MergedLine {
	removedIdx: number;
	addedIdx: number;
	segments: MergedSegment[];
}

const MAX_LINE_LENGTH = 2000;
const MAX_LINES_PER_BLOCK = 50;
const MAX_EDIT_LENGTH = 500;
const DIFF_TIMEOUT_MS = 20;
const MIN_LINE_SIMILARITY = 0.35;
const MAX_CHANGE_RATIO = 0.7;

const WORD_CHAR_RE = /^[A-Za-z0-9_]$/;

type SegmenterLike = {
	segment(input: string): Iterable<{ segment: string }>;
};

let cachedSegmenter: SegmenterLike | null | undefined;

function getGraphemeSegmenter(): SegmenterLike | null {
	if (cachedSegmenter !== undefined) {
		return cachedSegmenter;
	}
	try {
		const IntlWithSegmenter = Intl as unknown as {
			Segmenter?: new (locale?: string, options?: { granularity: 'grapheme' }) => SegmenterLike;
		};
		if (typeof IntlWithSegmenter !== 'undefined' && typeof IntlWithSegmenter.Segmenter === 'function') {
			cachedSegmenter = new IntlWithSegmenter.Segmenter(undefined, { granularity: 'grapheme' });
		} else {
			cachedSegmenter = null;
		}
	} catch {
		cachedSegmenter = null;
	}
	return cachedSegmenter;
}

/**
 * 문자열을 사용자 인식 문자(grapheme) 배열로 분리합니다.
 * Intl.Segmenter 미지원 환경에서는 코드 포인트 단위로 폴백합니다.
 */
export function segmentGraphemes(text: string): string[] {
	if (!text) return [];
	const segmenter = getGraphemeSegmenter();
	if (segmenter) {
		const result: string[] = [];
		for (const item of segmenter.segment(text)) {
			result.push(item.segment);
		}
		return result;
	}
	return Array.from(text);
}

let cachedWordSegmenter: WordSegmenterLike | null | undefined;

type WordSegmenterLike = {
	segment(input: string): Iterable<{ segment: string }>;
};

function getWordSegmenter(): WordSegmenterLike | null {
	if (cachedWordSegmenter !== undefined) {
		return cachedWordSegmenter;
	}
	try {
		const IntlWithSegmenter = Intl as unknown as {
			Segmenter?: new (locale?: string, options?: { granularity: 'word' }) => WordSegmenterLike;
		};
		if (typeof IntlWithSegmenter !== 'undefined' && typeof IntlWithSegmenter.Segmenter === 'function') {
			cachedWordSegmenter = new IntlWithSegmenter.Segmenter(undefined, { granularity: 'word' });
		} else {
			cachedWordSegmenter = null;
		}
	} catch {
		cachedWordSegmenter = null;
	}
	return cachedWordSegmenter;
}

/**
 * 문자열을 단어(어절) 토큰 배열로 분리합니다. 공백/구두점도 별도 토큰으로 유지되어 join하면 원문이 복원됩니다.
 * Intl.Segmenter 미지원 환경에서는 grapheme 단위로 폴백합니다.
 */
export function segmentWords(text: string): string[] {
	if (!text) return [];
	const segmenter = getWordSegmenter();
	if (segmenter) {
		const result: string[] = [];
		for (const item of segmenter.segment(text)) {
			result.push(item.segment);
		}
		return result;
	}
	return segmentGraphemes(text);
}

/**
 * diffLines의 value를 줄 단위 배열로 분리합니다 (CRLF 정규화 및 후행 빈 줄 제거).
 */
export function splitDiffLines(text: string): string[] {
	if (!text) return [];
	const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
	const lines = normalized.split('\n');
	if (lines.length > 0 && lines[lines.length - 1] === '') {
		lines.pop();
	}
	return lines;
}

function isWordChar(grapheme: string): boolean {
	return grapheme.length === 1 && WORD_CHAR_RE.test(grapheme);
}

/**
 * 두 줄 간의 문자 빈도 기반 유사도(Dice 계수, 0~1)를 계산합니다.
 */
function computeLineSimilarity(a: string, b: string): number {
	if (a === b) return 1;
	if (!a || !b) return 0;

	const charsA = Array.from(a);
	const charsB = Array.from(b);
	const freq = new Map<string, number>();

	for (const ch of charsA) {
		freq.set(ch, (freq.get(ch) ?? 0) + 1);
	}

	let intersection = 0;
	for (const ch of charsB) {
		const count = freq.get(ch);
		if (count && count > 0) {
			intersection++;
			freq.set(ch, count - 1);
		}
	}

	return (2 * intersection) / (charsA.length + charsB.length);
}

/**
 * 삭제된 줄들과 추가된 줄들을 순서를 유지하며 가장 유사한 쌍으로 매칭합니다.
 * 반환 배열의 각 요소는 [removedIdx, addedIdx]입니다.
 */
function matchLinesMonotonic(removedLines: string[], addedLines: string[]): Array<[number, number]> {
	const m = removedLines.length;
	const n = addedLines.length;
	if (m === 0 || n === 0) return [];

	// 줄 수가 같으면 1:1 순서 매칭
	if (m === n) {
		const pairs: Array<[number, number]> = [];
		for (let i = 0; i < m; i++) {
			if (computeLineSimilarity(removedLines[i], addedLines[i]) >= MIN_LINE_SIMILARITY) {
				pairs.push([i, i]);
			}
		}
		return pairs;
	}

	// DP로 순서 보존 최대 유사도 매칭 계산
	const sim: number[][] = Array.from({ length: m }, (_, i) =>
		Array.from({ length: n }, (_, j) => {
			const s = computeLineSimilarity(removedLines[i], addedLines[j]);
			return s >= MIN_LINE_SIMILARITY ? s : 0;
		}),
	);

	const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
	for (let i = m - 1; i >= 0; i--) {
		for (let j = n - 1; j >= 0; j--) {
			const skipI = dp[i + 1][j];
			const skipJ = dp[i][j + 1];
			const take = sim[i][j] > 0 ? sim[i][j] + dp[i + 1][j + 1] : -1;
			dp[i][j] = Math.max(skipI, skipJ, take);
		}
	}

	const pairs: Array<[number, number]> = [];
	let i = 0;
	let j = 0;
	while (i < m && j < n) {
		if (sim[i][j] > 0 && dp[i][j] === sim[i][j] + dp[i + 1][j + 1]) {
			pairs.push([i, j]);
			i++;
			j++;
		} else if (dp[i + 1][j] >= dp[i][j + 1]) {
			i++;
		} else {
			j++;
		}
	}
	return pairs;
}

interface GraphemeRun {
	graphemes: string[];
	changed: boolean;
}

/**
 * 인접한 동일 상태의 세그먼트를 병합합니다.
 */
function mergeAdjacentRuns(runs: GraphemeRun[]): GraphemeRun[] {
	const merged: GraphemeRun[] = [];
	for (const run of runs) {
		if (run.graphemes.length === 0) continue;
		const last = merged[merged.length - 1];
		if (last && last.changed === run.changed) {
			last.graphemes.push(...run.graphemes);
		} else {
			merged.push({ graphemes: [...run.graphemes], changed: run.changed });
		}
	}
	return merged;
}

/**
 * 짧은 미변경 구간 병합 및 영문/숫자 단어 경계 확장을 수행해 가독성을 높입니다.
 */
function refineRuns(rawRuns: GraphemeRun[]): InlineSegment[] | null {
	let runs = mergeAdjacentRuns(rawRuns);

	// 1. 양쪽이 changed인 짧은(1글자 이하 또는 공백만 있는) equal 구간을 changed로 병합
	let changed = true;
	while (changed) {
		changed = false;
		const next: GraphemeRun[] = [];
		for (let i = 0; i < runs.length; i++) {
			const curr = runs[i];
			const prev = next[next.length - 1];
			const succ = runs[i + 1];
			const isShortOrSpace =
				curr.graphemes.length <= 1 || curr.graphemes.every((g) => g.trim() === '');

			if (!curr.changed && prev?.changed && succ?.changed && isShortOrSpace) {
				prev.graphemes.push(...curr.graphemes);
				changed = true;
			} else {
				next.push(curr);
			}
		}
		runs = mergeAdjacentRuns(next);
	}

	// 2. ASCII 영문/숫자 단어 중간에서 잘린 경우 단어 전체로 확장 (CJK는 확장하지 않음)
	for (let i = 0; i < runs.length; i++) {
		const curr = runs[i];
		if (!curr.changed || curr.graphemes.length === 0) continue;

		// 앞쪽 equal 세그먼트와 단어 경계가 닿아 있으면 확장
		const prev = i > 0 ? runs[i - 1] : null;
		if (prev && !prev.changed && isWordChar(curr.graphemes[0])) {
			while (prev.graphemes.length > 0 && isWordChar(prev.graphemes[prev.graphemes.length - 1])) {
				curr.graphemes.unshift(prev.graphemes.pop()!);
			}
		}

		// 뒤쪽 equal 세그먼트와 단어 경계가 닿아 있으면 확장
		const succ = i + 1 < runs.length ? runs[i + 1] : null;
		if (succ && !succ.changed && isWordChar(curr.graphemes[curr.graphemes.length - 1])) {
			while (succ.graphemes.length > 0 && isWordChar(succ.graphemes[0])) {
				curr.graphemes.push(succ.graphemes.shift()!);
			}
		}
	}

	runs = mergeAdjacentRuns(runs);

	let totalGraphemes = 0;
	let changedGraphemes = 0;
	for (const run of runs) {
		totalGraphemes += run.graphemes.length;
		if (run.changed) {
			changedGraphemes += run.graphemes.length;
		}
	}

	if (totalGraphemes === 0 || changedGraphemes === 0) {
		return null;
	}

	// 변경 비율이 너무 높으면 줄 전체 하이라이트가 더 깔끔함
	if (changedGraphemes / totalGraphemes > MAX_CHANGE_RATIO) {
		return null;
	}

	return runs.map((run) => ({
		text: run.graphemes.join(''),
		changed: run.changed,
	}));
}

/**
 * 단일 (삭제 줄, 추가 줄) 쌍에 대해 인라인 세그먼트를 계산합니다.
 */
function computeLinePair(
	oldLine: string,
	newLine: string,
): { removed: InlineSegment[] | null; added: InlineSegment[] | null } {
	if (oldLine.length > MAX_LINE_LENGTH || newLine.length > MAX_LINE_LENGTH) {
		return { removed: null, added: null };
	}
	if (!oldLine || !newLine || oldLine === newLine) {
		return { removed: null, added: null };
	}

	// 단어(어절) 단위로 먼저 비교해 치환된 단어가 파편화되지 않고 한 덩어리로 강조되도록 한다
	const changes = diffArrays(segmentWords(oldLine), segmentWords(newLine), {
		timeout: DIFF_TIMEOUT_MS,
		maxEditLength: MAX_EDIT_LENGTH,
	});

	if (!changes) {
		return { removed: null, added: null };
	}

	const removedRuns: GraphemeRun[] = [];
	const addedRuns: GraphemeRun[] = [];
	let pendingRemoved: string[] = [];
	let pendingAdded: string[] = [];

	/** 연속된 삭제/추가 토큰 묶음을 하나의 치환 단위로 변환한다 */
	const flushPending = (): void => {
		if (pendingRemoved.length === 0 && pendingAdded.length === 0) return;
		const oldG = segmentGraphemes(pendingRemoved.join(''));
		const newG = segmentGraphemes(pendingAdded.join(''));
		pendingRemoved = [];
		pendingAdded = [];

		// 치환된 어절 앞뒤의 공통 부분(한글 조사/어미 등)은 변경에서 제외 (영문/숫자는 단어 단위 유지)
		let prefix = 0;
		const maxTrim = Math.min(oldG.length, newG.length);
		while (prefix < maxTrim && oldG[prefix] === newG[prefix] && !isWordChar(oldG[prefix])) {
			prefix++;
		}
		let suffix = 0;
		while (
			suffix < maxTrim - prefix &&
			oldG[oldG.length - 1 - suffix] === newG[newG.length - 1 - suffix] &&
			!isWordChar(oldG[oldG.length - 1 - suffix])
		) {
			suffix++;
		}

		const prefixG = oldG.slice(0, prefix);
		const suffixG = suffix > 0 ? oldG.slice(oldG.length - suffix) : [];
		removedRuns.push({ graphemes: prefixG, changed: false });
		removedRuns.push({ graphemes: oldG.slice(prefix, oldG.length - suffix), changed: true });
		removedRuns.push({ graphemes: suffixG, changed: false });
		addedRuns.push({ graphemes: [...prefixG], changed: false });
		addedRuns.push({ graphemes: newG.slice(prefix, newG.length - suffix), changed: true });
		addedRuns.push({ graphemes: [...suffixG], changed: false });
	};

	for (const ch of changes) {
		if (ch.removed) {
			pendingRemoved.push(...ch.value);
		} else if (ch.added) {
			pendingAdded.push(...ch.value);
		} else {
			flushPending();
			const equalG = segmentGraphemes(ch.value.join(''));
			removedRuns.push({ graphemes: equalG, changed: false });
			addedRuns.push({ graphemes: [...equalG], changed: false });
		}
	}
	flushPending();

	const removed = refineRuns(removedRuns);
	const added = refineRuns(addedRuns);

	// 양쪽 모두 임계값을 넘으면 인라인 하이라이트 생략
	if (!removed && !added) {
		return { removed: null, added: null };
	}

	return { removed, added };
}

/**
 * 삭제 줄/추가 줄의 세그먼트를 공통 구간 기준으로 정렬해 한 줄(removed → added 순)로 병합합니다.
 * 공통 구간의 텍스트가 서로 맞지 않으면 null을 반환합니다.
 */
function mergeLineSegments(removed: InlineSegment[], added: InlineSegment[]): MergedSegment[] | null {
	const out: MergedSegment[] = [];
	const push = (text: string, kind: MergedSegment['kind']): void => {
		if (!text) return;
		const last = out[out.length - 1];
		if (last && last.kind === kind) {
			last.text += text;
		} else {
			out.push({ text, kind });
		}
	};

	let i = 0;
	let j = 0;
	let ro = 0;
	let ao = 0;
	while (i < removed.length || j < added.length) {
		if (i < removed.length && removed[i].changed) {
			push(removed[i].text, 'removed');
			i++;
			ro = 0;
			continue;
		}
		if (j < added.length && added[j].changed) {
			push(added[j].text, 'added');
			j++;
			ao = 0;
			continue;
		}
		if (i >= removed.length || j >= added.length) return null;

		const rText = removed[i].text.slice(ro);
		const aText = added[j].text.slice(ao);
		const n = Math.min(rText.length, aText.length);
		if (rText.slice(0, n) !== aText.slice(0, n)) return null;
		push(rText.slice(0, n), 'equal');
		ro += n;
		ao += n;
		if (ro >= removed[i].text.length) {
			i++;
			ro = 0;
		}
		if (ao >= added[j].text.length) {
			j++;
			ao = 0;
		}
	}
	return out;
}

/**
 * 인접한 삭제 블록과 추가 블록을 줄 단위로 짝지어 글자(grapheme) 단위 인라인 diff를 계산합니다.
 */
export function computeInlineDiff(removedText: string, addedText: string): InlineDiffResult {
	const removedLines = splitDiffLines(removedText);
	const addedLines = splitDiffLines(addedText);

	const removedResult: (InlineSegment[] | null)[] = new Array<InlineSegment[] | null>(removedLines.length).fill(null);
	const addedResult: (InlineSegment[] | null)[] = new Array<InlineSegment[] | null>(addedLines.length).fill(null);
	const mergedResult: MergedLine[] = [];

	if (
		removedLines.length === 0 ||
		addedLines.length === 0 ||
		removedLines.length > MAX_LINES_PER_BLOCK ||
		addedLines.length > MAX_LINES_PER_BLOCK
	) {
		return { removed: removedResult, added: addedResult, merged: mergedResult };
	}

	const pairs = matchLinesMonotonic(removedLines, addedLines);
	for (const [rIdx, aIdx] of pairs) {
		const pairDiff = computeLinePair(removedLines[rIdx], addedLines[aIdx]);
		removedResult[rIdx] = pairDiff.removed;
		addedResult[aIdx] = pairDiff.added;

		if (pairDiff.removed || pairDiff.added) {
			const segments = mergeLineSegments(
				pairDiff.removed ?? [{ text: removedLines[rIdx], changed: false }],
				pairDiff.added ?? [{ text: addedLines[aIdx], changed: false }],
			);
			if (segments) {
				mergedResult.push({ removedIdx: rIdx, addedIdx: aIdx, segments });
			}
		}
	}

	return { removed: removedResult, added: addedResult, merged: mergedResult };
}
