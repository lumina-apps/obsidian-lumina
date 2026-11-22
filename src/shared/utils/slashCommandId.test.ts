import { describe, it, expect } from 'vitest';
import {
	BUILTIN_SLASH_COMMAND_IDS,
	toSlashCommandId,
	resolveQuickActionSlashIds,
} from './slashCommandId';
import type { QuickAction } from '../types/settings.types';

function makeAction(overrides: Partial<QuickAction> & { id: string }): QuickAction {
	return {
		name: 'Action',
		prompt: 'Do something',
		actionType: 'chat',
		...overrides,
	};
}

describe('slashCommandId', () => {
	describe('toSlashCommandId', () => {
		it('한글과 공백을 소문자 하이픈 슬러그로 변환한다', () => {
			expect(toSlashCommandId('한국어로 번역')).toBe('한국어로-번역');
			expect(toSlashCommandId('  Summarize   Code  ')).toBe('summarize-code');
		});

		it('파일명 금지 문자 및 구두점을 제거한다', () => {
			expect(toSlashCommandId('Check / Fix: *Bug*? "Now" <1>|2!')).toBe('check-fix-bug-now-12');
			expect(toSlashCommandId('my_custom-action.v2')).toBe('my_custom-actionv2');
		});

		it('30자를 초과하면 자르고 끝의 하이픈을 제거한다', () => {
			const longName = 'abcdefghijklmnopqrstuvwxyz1234567890';
			expect(toSlashCommandId(longName)).toHaveLength(30);

			const boundaryHyphen = 'a'.repeat(29) + ' bbbb';
			expect(toSlashCommandId(boundaryHyphen)).toBe('a'.repeat(29));
		});

		it('특수문자만 있거나 빈 문자열이면 빈 문자열을 반환한다', () => {
			expect(toSlashCommandId('   ')).toBe('');
			expect(toSlashCommandId('!@#$%^&*()')).toBe('');
		});
	});

	describe('resolveQuickActionSlashIds', () => {
		it('프롬프트가 비어 있는 퀵 액션은 제외한다', () => {
			const actions: QuickAction[] = [
				makeAction({ id: 'qa-1', name: 'Empty', prompt: '   ' }),
				makeAction({ id: 'qa-2', name: 'Valid', prompt: 'Summarize' }),
			];

			const map = resolveQuickActionSlashIds(actions);
			expect(map.has('qa-1')).toBe(false);
			expect(map.get('qa-2')).toBe('valid');
		});

		it('이름에서 슬러그를 만들 수 없으면 prompt-{n} 폴백을 사용한다', () => {
			const actions: QuickAction[] = [
				makeAction({ id: 'qa-1', name: '!!!', prompt: 'Prompt 1' }),
				makeAction({ id: 'qa-2', name: '   ', prompt: 'Prompt 2' }),
			];

			const map = resolveQuickActionSlashIds(actions);
			expect(map.get('qa-1')).toBe('prompt-1');
			expect(map.get('qa-2')).toBe('prompt-2');
		});

		it('기본 슬래시 명령어 ID와 충돌하면 -2 접미사를 붙인다', () => {
			const actions: QuickAction[] = [
				makeAction({ id: 'qa-1', name: 'Clear', prompt: 'Clear something' }),
				makeAction({ id: 'qa-2', name: 'Settings', prompt: 'Check settings' }),
			];

			const map = resolveQuickActionSlashIds(actions);
			expect(BUILTIN_SLASH_COMMAND_IDS).toContain('clear');
			expect(map.get('qa-1')).toBe('clear-2');
			expect(map.get('qa-2')).toBe('settings-2');
		});

		it('동일한 슬러그가 중복되면 순서대로 -2, -3 접미사를 부여한다', () => {
			const actions: QuickAction[] = [
				makeAction({ id: 'qa-1', name: '요약하기', prompt: 'A' }),
				makeAction({ id: 'qa-2', name: '요약하기', prompt: 'B' }),
				makeAction({ id: 'qa-3', name: '요약하기', prompt: 'C' }),
			];

			const map = resolveQuickActionSlashIds(actions);
			expect(map.get('qa-1')).toBe('요약하기');
			expect(map.get('qa-2')).toBe('요약하기-2');
			expect(map.get('qa-3')).toBe('요약하기-3');
		});

		it('중복 접미사를 붙여도 30자 제한을 넘지 않는다', () => {
			const longName = 'a'.repeat(30);
			const actions: QuickAction[] = [
				makeAction({ id: 'qa-1', name: longName, prompt: 'A' }),
				makeAction({ id: 'qa-2', name: longName, prompt: 'B' }),
			];

			const map = resolveQuickActionSlashIds(actions);
			expect(map.get('qa-1')).toHaveLength(30);
			expect(map.get('qa-2')).toHaveLength(30);
			expect(map.get('qa-2')?.endsWith('-2')).toBe(true);
		});
	});
});
