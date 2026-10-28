import { normalizePath } from 'obsidian';
import { t } from '../../../shared/locales/helpers';
import type { ToolArguments, ToolHandlerContext, ToolResult } from './toolTypes';
import type { PathGuard } from './pathGuard';

/** 읽기 결과가 limitRead를 초과하면 자릅니다. */
export function applyReadLimit(content: string, limit: number): string {
	if (content.length > limit) {
		return content.substring(0, limit) + t('mcpServerTools.common.truncated', { limit });
	}
	return content;
}

/** args에서 string 값을 안전하게 추출합니다 (런타임 타입 가드). */
export function getStringArg(args: ToolArguments, key: string): string {
	const val = args[key];
	return typeof val === 'string' ? val : '';
}

/** args에서 number 값을 안전하게 추출합니다 (숫자 및 숫자형 문자열 지원). */
export function getNumberArg(args: ToolArguments, key: string): number | undefined {
	const val = args[key];
	if (typeof val === 'number' && !isNaN(val)) return val;
	if (typeof val === 'string' && val.trim() !== '') {
		const num = Number(val);
		if (!isNaN(num)) return num;
	}
	return undefined;
}

/** args에서 string | undefined 값을 안전하게 추출합니다. */
export function getStringOptArg(args: ToolArguments, key: string): string | undefined {
	const val = args[key];
	if (val === undefined || val === null) return undefined;
	return typeof val === 'string' ? val : undefined;
}

/** 오늘 날짜(yyyy-MM-dd)를 반환합니다. */
export function getTodayString(): string {
	return new Date().toISOString().split('T')[0];
}

interface DailyNotesConfig {
	folder?: string;
	format?: string;
}

/**
 * Obsidian Daily Notes 플러그인 설정을 기반으로 데일리 노트 경로를 반환합니다.
 * targetDate가 전달되면 해당 일자의 노트를 찾고, 생략 시 오늘의 노트를 반환합니다.
 * 코어 플러그인이 비활성화되었거나 설정을 읽지 못하면 vault 루트의 YYYY-MM-DD.md로 폴백합니다.
 */
export async function getDailyNotePath(app: import('obsidian').App, targetDate?: string): Promise<string> {
	let folder = '';
	let format = 'YYYY-MM-DD';

	try {
		const configDir = app.vault.configDir;
		if (configDir) {
			const configPath = normalizePath(`${configDir}/daily-notes.json`);
			if (await app.vault.adapter.exists(configPath)) {
				const raw = await app.vault.adapter.read(configPath);
				const config = JSON.parse(raw) as DailyNotesConfig;
				if (config.folder) folder = config.folder;
				if (config.format) format = config.format;
			}
		}
	} catch {
		// 설정 파일을 읽지 못하면 기본값 사용
	}

	let filename = targetDate || getTodayString();
	const winMoment = typeof window !== 'undefined'
		? (window as unknown as { moment?: (date?: unknown, fmt?: unknown) => { isValid?: () => boolean; format: (f: string) => string } }).moment
		: undefined;

	if (typeof winMoment === 'function') {
		try {
			const m = targetDate ? winMoment(targetDate) : winMoment();
			if (m && typeof m.format === 'function' && (!m.isValid || m.isValid())) {
				filename = m.format(format);
			}
		} catch {
			filename = targetDate || getTodayString();
		}
	}

	const path = folder ? normalizePath(`${folder}/${filename}.md`) : `${filename}.md`;
	return path;
}

/**
 * 파일 캐시에서 본문 및 프론트매터의 모든 태그를 '#' 접두사와 소문자로 정규화하여 중복 없이 추출합니다.
 */
export function getNormalizedFileTags(cache: import('obsidian').CachedMetadata | null | undefined): string[] {
	if (!cache) return [];
	const allTags: string[] = [];

	if (cache.tags && Array.isArray(cache.tags)) {
		for (const t of cache.tags) {
			if (t?.tag && typeof t.tag === 'string') {
				const lower = t.tag.trim().toLowerCase();
				allTags.push(lower.startsWith('#') ? lower : `#${lower}`);
			}
		}
	}

	const fm = cache.frontmatter;
	const fmTags = fm?.tags ?? fm?.tag;
	if (fmTags) {
		const rawList = Array.isArray(fmTags) ? fmTags : [fmTags];
		for (const t of rawList) {
			if (typeof t === 'string' && t.trim()) {
				const lower = t.trim().toLowerCase();
				allTags.push(lower.startsWith('#') ? lower : `#${lower}`);
			}
		}
	}

	return Array.from(new Set(allTags));
}

/**
 * 파일에 존재하는 태그 목록이 요청된 모든 태그를 포함하는지 대소문자 구분 없이 검사합니다.
 */
export function fileMatchesTags(fileTags: string[], requestedTags: string[]): boolean {
	return requestedTags.every((req) => {
		const clean = req.trim().toLowerCase();
		const target = clean.startsWith('#') ? clean : `#${clean}`;
		return fileTags.includes(target);
	});
}

/** 경로 접근 가능 여부를 확인하고 거부 시 오류 결과를 반환합니다. */
export function blockIfPathNotAllowed(
	path: string,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): ToolResult | null {
	if (!pathGuard.isAgentPathAllowed(path, ctx.plugin)) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.common.pathExcluded', { path }) }] };
	}
	return null;
}