/**
 * diffExtension.test.ts
 * CodeMirror 인라인 diff 데코레이션(RangeSetBuilder 정렬, 오프셋, 위젯 렌더링) 검증
 */
import { describe, it, expect, vi } from 'vitest';
import { EditorState, StateField } from '@codemirror/state';
import { diffLines } from 'diff';

vi.mock('obsidian', async (importOriginal) => {
	const actual = await importOriginal<typeof import('obsidian')>();
	return {
		...actual,
		editorInfoField: StateField.define<null>({
			create: () => null,
			update: (v) => v,
		}),
	};
});

import { diffDecorationField, setDiffs } from './diffExtension';
import type { ApprovalRequest, EnrichedChange } from '../../core/store/approvalStore';

function createApprovalRequest(baseContent: string, proposedContent: string): ApprovalRequest {
	const rawChanges = diffLines(baseContent, proposedContent);
	const chunkId = 'chunk-1';
	const allChanges: EnrichedChange[] = rawChanges.map((ch) =>
		ch.added || ch.removed ? { ...ch, chunkId } : { ...ch },
	);
	const chunkChanges = allChanges.filter((ch) => ch.chunkId === chunkId);

	return {
		id: 'req-1',
		filePath: 'test.md',
		baseContent,
		proposedContent,
		allChanges,
		chunks: [
			{
				id: chunkId,
				changes: chunkChanges,
				status: 'pending',
				startLine: 1,
				isTable: false,
			},
		],
		resolve: () => {},
	};
}

describe('diffDecorationField inline diff', () => {
	it('한국어 문장의 변경된 글자 위치에만 mark decoration을 추가한다', () => {
		const docText = '오늘은 날씨가 좋다\n';
		const proposed = '오늘은 날씨가 나쁘다\n';
		const request = createApprovalRequest(docText, proposed);

		const state = EditorState.create({
			doc: docText,
			extensions: [diffDecorationField],
		});

		const nextState = state.update({ effects: setDiffs.of(request) }).state;
		const decos = nextState.field(diffDecorationField);

		const marks: Array<{ from: number; to: number; text: string }> = [];
		const addedWidgets: HTMLElement[] = [];
		const inlineAdded: Array<{ from: number; text: string }> = [];

		const iter = decos.iter();
		while (iter.value) {
			const spec = iter.value.spec as { class?: string; widget?: { toDOM: () => HTMLElement } };
			if (spec.class === 'lumina-diff-inline-removed') {
				marks.push({
					from: iter.from,
					to: iter.to,
					text: docText.slice(iter.from, iter.to),
				});
			}
			if (spec.widget && spec.widget.constructor.name === 'DiffAddedWidget') {
				addedWidgets.push(spec.widget.toDOM());
			}
			if (spec.widget && spec.widget.constructor.name === 'DiffInlineAddedWidget') {
				inlineAdded.push({ from: iter.from, text: spec.widget.toDOM().textContent ?? '' });
			}
			iter.next();
		}

		// 짝이 맞는 줄은 한 줄로 병합: 삭제 단어에 mark, 추가 단어는 바로 뒤에 인라인 위젯
		expect(marks).toEqual([{ from: 8, to: 9, text: '좋' }]);
		expect(inlineAdded).toEqual([{ from: 9, text: '나쁘' }]);
		expect(addedWidgets).toHaveLength(0);
	});

	it('문장이 처음(offset 0)부터 변경되어도 RangeSetBuilder 정렬 오류 없이 생성된다', () => {
		const docText = '가나다라마바사\n';
		const proposed = '하나다라마바사\n';
		const request = createApprovalRequest(docText, proposed);

		const state = EditorState.create({
			doc: docText,
			extensions: [diffDecorationField],
		});

		const nextState = state.update({ effects: setDiffs.of(request) }).state;
		const decos = nextState.field(diffDecorationField);

		const marks: string[] = [];
		const iter = decos.iter();
		while (iter.value) {
			const spec = iter.value.spec as { class?: string };
			if (spec.class === 'lumina-diff-inline-removed') {
				marks.push(docText.slice(iter.from, iter.to));
			}
			iter.next();
		}

		expect(marks).toEqual(['가']);
	});

	it('문서 내용이 변경되어 삭제 줄과 불일치하면 mark decoration을 생략하고 줄 데코만 유지한다', () => {
		const docText = '사용자가 먼저 수정한 줄\n';
		const request = createApprovalRequest('오늘은 날씨가 좋다\n', '오늘은 날씨가 나쁘다\n');

		const state = EditorState.create({
			doc: docText,
			extensions: [diffDecorationField],
		});

		const nextState = state.update({ effects: setDiffs.of(request) }).state;
		const decos = nextState.field(diffDecorationField);

		const marks: string[] = [];
		let hasRemovedLine = false;
		const iter = decos.iter();
		while (iter.value) {
			const spec = iter.value.spec as { class?: string };
			if (spec.class === 'lumina-diff-inline-removed') {
				marks.push(docText.slice(iter.from, iter.to));
			}
			if (spec.class === 'lumina-diff-removed-line') {
				hasRemovedLine = true;
			}
			iter.next();
		}

		expect(hasRemovedLine).toBe(true);
		expect(marks).toEqual([]);
	});
});
