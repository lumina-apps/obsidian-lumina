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

/** args에서 number 값을 안전하게 추출합니다 (런타임 타입 가드). */
export function getNumberArg(args: ToolArguments, key: string): number | undefined {
	const val = args[key];
	return typeof val === 'number' ? val : undefined;
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
 * Obsidian Daily Notes 플러그인 설정을 기반으로 오늘의 데일리 노트 경로를 반환합니다.
 * 코어 플러그인이 비활성화되었거나 설정을 읽지 못하면 vault 루트의 YYYY-MM-DD.md로 폴백합니다.
 */
export async function getDailyNotePath(app: import('obsidian').App): Promise<string> {
	let folder = '';
	let format = 'YYYY-MM-DD';

	try {
		const configPath = normalizePath('.obsidian/daily-notes.json');
		if (await app.vault.adapter.exists(configPath)) {
			const raw = await app.vault.adapter.read(configPath);
			const config = JSON.parse(raw) as DailyNotesConfig;
			if (config.folder) folder = config.folder;
			if (config.format) format = config.format;
		}
	} catch {
		// 설정 파일을 읽지 못하면 기본값 사용
	}

	let filename = getTodayString();
	if (typeof window !== 'undefined' && typeof (window as unknown as { moment?: () => { format: (fmt: string) => string } }).moment === 'function') {
		try {
			const m = (window as unknown as { moment: () => { format: (fmt: string) => string } }).moment();
			filename = m.format(format);
		} catch {
			filename = getTodayString();
		}
	}

	const path = folder ? normalizePath(`${folder}/${filename}.md`) : `${filename}.md`;
	return path;
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