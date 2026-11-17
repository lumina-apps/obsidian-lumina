import { moment, normalizePath } from 'obsidian';
import { debugLogger } from '../debugLogger';
import { sanitizeFilename } from './fileUtils';

/** 날짜를 Moment.js 포맷 문자열로 변환하는 함수 타입 */
export type DateFormatter = (date: Date, format: string) => string;

/** 날짜 경로 템플릿 유효성 검사 결과 */
export interface TemplateValidationResult {
	valid: boolean;
	reason?: 'unclosed_braces' | 'empty_token' | 'traversal';
}

/**
 * 기본 날짜 포맷터. Obsidian이 제공하는 moment 인스턴스를 사용합니다.
 */
function defaultDateFormatter(date: Date, format: string): string {
	// obsidian.d.ts의 moment 타입은 네임스페이스로 선언되어 있어 호출 시그니처를 좁혀 사용한다
	const momentFn = moment as unknown as (inp?: Date) => {
		isValid?: () => boolean;
		format?: (fmt: string) => string;
	} | undefined;
	const m = momentFn(date);
	if (!m || typeof m.format !== 'function') {
		return '';
	}
	if (typeof m.isValid === 'function' && !m.isValid()) {
		return 'Invalid date';
	}
	return m.format(format);
}

/**
 * 상대 폴더 경로를 크로스 플랫폼(Windows/macOS/모바일) 안전하게 정제합니다.
 * - 역슬래시(\)를 슬래시(/)로 변환 후 세그먼트 분리
 * - 빈 세그먼트, '.', '..' 경로 탈출 세그먼트 제거
 * - 각 세그먼트에 sanitizeFilename 적용 (금지 문자, 후행 점/공백, Windows 예약어 처리)
 */
export function sanitizeRelativeFolder(rawPath: string): string {
	if (!rawPath) return '';

	const segments = rawPath.replace(/\\/g, '/').split('/');
	const safeSegments: string[] = [];

	for (const seg of segments) {
		const trimmed = seg.trim();
		if (!trimmed || trimmed === '.' || trimmed === '..') {
			continue;
		}
		const safe = sanitizeFilename(trimmed);
		if (!safe || safe === '.' || safe === '..') {
			continue;
		}
		safeSegments.push(safe);
	}

	if (safeSegments.length === 0) {
		return '';
	}

	return normalizePath(safeSegments.join('/'));
}

/**
 * 날짜 폴더 템플릿 문자열의 문법 유효성을 검사합니다.
 * - 중첩되거나 짝이 맞지 않는 {{ / }}
 * - 비어 있는 토큰 ({{}})
 * - 상위 경로 이동 세그먼트 (..)
 */
export function validateDateTemplate(template: string): TemplateValidationResult {
	if (!template || !template.trim()) {
		return { valid: true };
	}

	// 경로 탈출 세그먼트(..) 검사
	const rawSegments = template.replace(/\\/g, '/').split('/');
	if (rawSegments.some(seg => seg.trim() === '..')) {
		return { valid: false, reason: 'traversal' };
	}

	let inToken = false;
	let tokenStart = -1;
	let i = 0;

	while (i < template.length) {
		if (!inToken) {
			if (template.startsWith('{{', i)) {
				inToken = true;
				tokenStart = i + 2;
				i += 2;
				continue;
			}
			if (template.startsWith('}}', i)) {
				return { valid: false, reason: 'unclosed_braces' };
			}
			i += 1;
		} else {
			if (template.startsWith('{{', i)) {
				return { valid: false, reason: 'unclosed_braces' };
			}
			if (template.startsWith('}}', i)) {
				const tokenContent = template.slice(tokenStart, i).trim();
				if (!tokenContent) {
					return { valid: false, reason: 'empty_token' };
				}
				inToken = false;
				tokenStart = -1;
				i += 2;
				continue;
			}
			i += 1;
		}
	}

	if (inToken) {
		return { valid: false, reason: 'unclosed_braces' };
	}

	return { valid: true };
}

/**
 * 날짜 포맷 템플릿({{YYYY}}/{{MM}} 등)을 실제 상대 폴더 경로로 해석합니다.
 * 잘못된 템플릿이나 유효하지 않은 날짜가 들어오면 빈 문자열(평면 저장)로 폴백합니다.
 */
export function resolveDateTemplate(
	template: string,
	date: Date,
	formatter: DateFormatter = defaultDateFormatter,
): string {
	if (!template || !template.trim()) {
		return '';
	}

	const validation = validateDateTemplate(template);
	if (!validation.valid) {
		debugLogger.logWarn('history', `Invalid date folder template "${template}": ${validation.reason}`);
		return '';
	}

	if (!(date instanceof Date) || Number.isNaN(date.getTime())) {
		debugLogger.logWarn('history', `Invalid date passed to resolveDateTemplate: ${String(date)}`);
		return '';
	}

	let failed = false;
	const expanded = template.replace(/\{\{([^{}]+)\}\}/g, (_match, token: string) => {
		const trimmedToken = token.trim();
		if (!trimmedToken) {
			failed = true;
			return '';
		}
		const formatted = formatter(date, trimmedToken);
		if (formatted === 'Invalid date') {
			failed = true;
			return '';
		}
		return formatted;
	});

	if (failed) {
		debugLogger.logWarn('history', `Date formatting failed for template "${template}"`);
		return '';
	}

	return sanitizeRelativeFolder(expanded);
}
