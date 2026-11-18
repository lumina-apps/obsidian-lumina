import { describe, it, expect } from 'vitest';
import { computeMinimalChange, computeScopedMinimalChange } from './editorAnnotations';

describe('editorAnnotations diff helpers', () => {
	describe('computeMinimalChange', () => {
		it('동일한 문자열이면 null을 반환한다', () => {
			expect(computeMinimalChange('hello world', 'hello world')).toBeNull();
		});

		it('공통 접두·접미를 제외한 최소 변경 구간만 계산한다', () => {
			expect(computeMinimalChange('Hello old world!', 'Hello new world!')).toEqual({
				from: 6,
				to: 9,
				insert: 'new',
			});
		});

		it('순수 추가 및 순수 삭제를 정확히 계산한다', () => {
			expect(computeMinimalChange('abc', 'abXYZc')).toEqual({
				from: 2,
				to: 2,
				insert: 'XYZ',
			});
			expect(computeMinimalChange('abXYZc', 'abc')).toEqual({
				from: 2,
				to: 5,
				insert: '',
			});
		});

		it('UTF-16 서로게이트 페어(이모지) 중간에서 분할하지 않는다', () => {
			const res = computeMinimalChange('x😀y', 'x😁y');
			expect(res).toEqual({
				from: 1,
				to: 3,
				insert: '😁',
			});
		});
	});

	describe('computeScopedMinimalChange', () => {
		it('지정된 대상 범위 내의 변경을 현재 오프셋 기준으로 정확히 변환한다', () => {
			const baseDoc = 'Intro\nHello old world\nOutro';
			const startOffset = 6;
			const endOffset = 21;
			const approvedDoc = 'Intro\nHello new world\nOutro';

			// 문서 앞부분에 4글자가 삽입되어 현재 대상 시작이 10으로 밀린 상태 가정
			const result = computeScopedMinimalChange(baseDoc, startOffset, endOffset, approvedDoc, 10);
			expect(result).toEqual({
				from: 16,
				to: 19,
				insert: 'new',
				isFullDoc: false,
			});
		});

		it('append 모드 삽입을 대상 범위 끝 지점 삽입으로 변환한다', () => {
			const baseDoc = 'Header\nTarget line\nFooter';
			const startOffset = 7;
			const endOffset = 18;
			const approvedDoc = 'Header\nTarget line\n\nAppended text\nFooter';

			const result = computeScopedMinimalChange(baseDoc, startOffset, endOffset, approvedDoc, 7);
			expect(result).toEqual({
				from: 18,
				to: 18,
				insert: '\n\nAppended text',
				isFullDoc: false,
			});
		});

		it('범위 바깥까지 수정된 예외 케이스에서는 isFullDoc: true 폴백을 반환한다', () => {
			const baseDoc = 'AAA\nBBB\nCCC';
			const approvedDoc = 'XXX\nBBB\nCCC';
			const result = computeScopedMinimalChange(baseDoc, 4, 7, approvedDoc, 4);
			expect(result).toEqual({
				from: 0,
				to: 3,
				insert: 'XXX',
				isFullDoc: true,
			});
		});
	});
});
