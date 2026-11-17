import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from 'vitest';
import { moment } from 'obsidian';
import realMoment from 'moment';
import {
	resolveDateTemplate,
	sanitizeRelativeFolder,
	validateDateTemplate,
} from './datePathTemplate';

describe('datePathTemplate', () => {
	const sampleDate = new Date(2026, 10, 17, 14, 30, 0); // 2026-11-17 14:30:00 (로컬 시각)
	const momentMock = moment as unknown as Mock;

	beforeEach(() => {
		momentMock.mockImplementation((inp?: unknown) => realMoment(inp as Date));
	});

	afterEach(() => {
		momentMock.mockReset();
	});

	describe('resolveDateTemplate', () => {
		it('{{YYYY}}/{{MM}} 포맷을 년/월 경로로 변환한다', () => {
			expect(resolveDateTemplate('{{YYYY}}/{{MM}}', sampleDate)).toBe('2026/11');
		});

		it('{{YYYY-MM-DD}} 및 단일 토큰 내 슬래시({{YYYY/MM}})를 지원한다', () => {
			expect(resolveDateTemplate('{{YYYY-MM-DD}}', sampleDate)).toBe('2026-11-17');
			expect(resolveDateTemplate('{{YYYY/MM}}', sampleDate)).toBe('2026/11');
		});

		it('Moment 리터럴 이스케이프([Notes])와 정적 경로 혼합을 처리한다', () => {
			expect(resolveDateTemplate('archive/{{YYYY}}/{{[W]WW}}', sampleDate)).toBe('archive/2026/W47');
		});

		it('토큰이 없는 정적 문자열은 sanitize 후 그대로 반환한다', () => {
			expect(resolveDateTemplate('archive/notes', sampleDate)).toBe('archive/notes');
		});

		it('빈 템플릿 또는 공백만 있는 템플릿은 빈 문자열을 반환한다', () => {
			expect(resolveDateTemplate('', sampleDate)).toBe('');
			expect(resolveDateTemplate('   ', sampleDate)).toBe('');
		});

		it('Windows 역슬래시(\\) 구분자를 슬래시(/)로 정규화한다', () => {
			expect(resolveDateTemplate('{{YYYY}}\\{{MM}}', sampleDate)).toBe('2026/11');
		});

		it('절대 경로 선행 슬래시, 경로 탈출(..), 금지 문자를 안전하게 차단/치환한다', () => {
			expect(resolveDateTemplate('/{{YYYY}}/{{MM}}/', sampleDate)).toBe('2026/11');
			expect(resolveDateTemplate('../outside/{{YYYY}}', sampleDate)).toBe('');
			expect(resolveDateTemplate('{{YYYY}}/{{HH:mm}}', sampleDate)).toBe('2026/14_30');
		});

		it('로케일 월 약어 끝의 마침표(.) 등 Windows 부적합 후행 문자를 제거한다', () => {
			const dotFormatter = () => 'nov.';
			expect(resolveDateTemplate('{{YYYY}}/{{MMM}}', sampleDate, (d, fmt) => (
				fmt === 'MMM' ? dotFormatter() : realMoment(d).format(fmt)
			))).toBe('2026/nov');
		});

		it('짝이 맞지 않는 중괄호나 유효하지 않은 날짜면 빈 문자열로 폴백한다', () => {
			expect(resolveDateTemplate('{{YYYY}/{{MM}}', sampleDate)).toBe('');
			expect(resolveDateTemplate('{{YYYY}}', new Date('invalid'))).toBe('');
		});
	});

	describe('sanitizeRelativeFolder', () => {
		it('빈 세그먼트, 점(.), Windows 예약어를 안전하게 정제한다', () => {
			expect(sanitizeRelativeFolder('///a/./b//')).toBe('a/b');
			expect(sanitizeRelativeFolder('CON/PRN/normal')).toBe('_CON/_PRN/normal');
			expect(sanitizeRelativeFolder('foo.../bar   ')).toBe('foo/bar');
		});
	});

	describe('validateDateTemplate', () => {
		it('유효한 템플릿을 통과시킨다', () => {
			expect(validateDateTemplate('')).toEqual({ valid: true });
			expect(validateDateTemplate('{{YYYY}}/{{MM}}')).toEqual({ valid: true });
			expect(validateDateTemplate('static/folder')).toEqual({ valid: true });
		});

		it('잘못된 템플릿의 원인을 반환한다', () => {
			expect(validateDateTemplate('{{YYYY')).toEqual({ valid: false, reason: 'unclosed_braces' });
			expect(validateDateTemplate('YYYY}}')).toEqual({ valid: false, reason: 'unclosed_braces' });
			expect(validateDateTemplate('{{{{YYYY}}}}')).toEqual({ valid: false, reason: 'unclosed_braces' });
			expect(validateDateTemplate('{{}}')).toEqual({ valid: false, reason: 'empty_token' });
			expect(validateDateTemplate('{{   }}')).toEqual({ valid: false, reason: 'empty_token' });
			expect(validateDateTemplate('../{{YYYY}}')).toEqual({ valid: false, reason: 'traversal' });
		});
	});
});
