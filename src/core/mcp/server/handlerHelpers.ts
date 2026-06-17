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