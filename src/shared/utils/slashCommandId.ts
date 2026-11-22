import type { QuickAction } from '../types/settings.types';

/**
 * 기본 내장 슬래시 명령어 ID 목록.
 * 채팅 입력창의 buildSlashCommands()가 생성하는 ID와 일치해야 합니다.
 */
export const BUILTIN_SLASH_COMMAND_IDS = [
	'clear',
	'rag',
	'websearch',
	'mode',
	'export',
	'regenerate',
	'compress',
	'mcp',
	'model',
	'prompt',
	'settings',
] as const;

/** 슬래시 명령어 최대 길이 (detectSlashCommand의 30자 제한과 일치) */
const MAX_SLASH_COMMAND_LENGTH = 30;

/**
 * 사용자 입력 이름(퀵 액션 이름 등)을 슬래시 명령어 ID(slug)로 변환합니다.
 * 공백은 '-'로 치환하고, 파일명/구두점 등 특수문자는 제거하며, 최대 30자로 제한합니다.
 */
export function toSlashCommandId(name: string): string {
	const normalized = name
		.trim()
		.toLowerCase()
		.replace(/\s+/g, '-')
		// 문자(한글/영문/다국어), 숫자, '-', '_'만 허용하고 나머지 구두점/특수문자 제거
		.replace(/[^\p{L}\p{N}_-]+/gu, '')
		.replace(/-{2,}/g, '-')
		.replace(/^-+|-+$/g, '');

	if (normalized.length <= MAX_SLASH_COMMAND_LENGTH) {
		return normalized;
	}
	return normalized.slice(0, MAX_SLASH_COMMAND_LENGTH).replace(/-+$/g, '');
}

/**
 * 퀵 액션 목록에 대해 채팅 슬래시 명령어 ID를 결정합니다.
 * - 프롬프트가 비어 있는 액션은 제외됩니다.
 * - 기본 명령어 ID 또는 앞선 액션의 ID와 충돌하면 '-2', '-3' 등의 접미사를 부여합니다.
 * - 배열 순서에 따라 결정적이므로 설정 화면과 채팅창에서 항상 동일한 ID를 반환합니다.
 */
export function resolveQuickActionSlashIds(actions: readonly QuickAction[]): Map<string, string> {
	const usedIds = new Set<string>(BUILTIN_SLASH_COMMAND_IDS);
	const result = new Map<string, string>();
	let fallbackCounter = 1;

	for (const action of actions) {
		if (!action.prompt || !action.prompt.trim()) {
			continue;
		}

		let base = toSlashCommandId(action.name ?? '');
		if (!base) {
			base = `prompt-${fallbackCounter}`;
			fallbackCounter++;
		}

		let candidate = base;
		if (usedIds.has(candidate)) {
			let suffixNum = 2;
			while (true) {
				const suffix = `-${suffixNum}`;
				const maxBaseLen = Math.max(1, MAX_SLASH_COMMAND_LENGTH - suffix.length);
				const truncatedBase = base.slice(0, maxBaseLen).replace(/-+$/g, '') || 'p';
				const nextCandidate = `${truncatedBase}${suffix}`;
				if (!usedIds.has(nextCandidate)) {
					candidate = nextCandidate;
					break;
				}
				suffixNum++;
			}
		}

		usedIds.add(candidate);
		result.set(action.id, candidate);
	}

	return result;
}
