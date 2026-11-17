import { normalizePath } from 'obsidian';
import {
	resolveDateTemplate,
	sanitizeRelativeFolder,
	validateDateTemplate,
} from './datePathTemplate';
import { sanitizeFilename } from './fileUtils';

/** 기본 채팅 히스토리 루트 폴더명 */
export const DEFAULT_CHAT_HISTORY_ROOT = 'chatHistory';

/** 채팅 히스토리 폴더 미리보기 계산 결과 */
export interface HistoryPreviewResult {
	/** 프로젝트 하위 폴더까지 반영된 베이스 경로 */
	basePath: string;
	/** 날짜 폴더 포맷까지 반영된 최종 저장 폴더 경로 */
	resolvedPath: string;
	/** 날짜 폴더 포맷 템플릿 유효 여부 */
	isFormatValid: boolean;
}

/**
 * 전역 채팅 히스토리 루트 경로를 볼트 상대 경로로 안전하게 정규화합니다.
 * 비어 있거나 모든 세그먼트가 제거되면 기본값('chatHistory')을 반환합니다.
 */
export function normalizeHistoryRootPath(rawPath?: string): string {
	return sanitizeRelativeFolder(rawPath ?? '') || DEFAULT_CHAT_HISTORY_ROOT;
}

/**
 * 프로젝트별 히스토리 하위 폴더 상대 경로를 안전하게 정제합니다.
 * 다단계 상대 경로(예: 'Work/Sub')는 유지하고 '..'·금지 문자는 제거·치환합니다.
 */
export function sanitizeHistorySubfolder(rawSubfolder?: string): string {
	return sanitizeRelativeFolder(rawSubfolder ?? '');
}

/**
 * 프로젝트 이름을 단일 폴더명 세그먼트로 안전하게 정제합니다.
 * 이름에 포함된 '/'는 하위 폴더 분리가 아닌 '_'로 치환합니다.
 */
export function sanitizeProjectFolderName(projectName?: string): string {
	const trimmed = (projectName ?? '').trim();
	if (!trimmed) return '';
	const safe = sanitizeFilename(trimmed);
	if (!safe || safe === '.' || safe === '..') {
		return '';
	}
	return safe;
}

/**
 * 사용자 입력 경로에 상위 경로 이동('..')이나 파일시스템 금지 문자가 포함되었는지 검사합니다.
 */
export function hasUnsafeHistoryPathInput(rawPath?: string): boolean {
	if (!rawPath || !rawPath.trim()) return false;
	const segments = rawPath.replace(/\\/g, '/').split('/');
	if (segments.some(seg => seg.trim() === '..')) {
		return true;
	}
	return /[:*?"<>|\r\n\t\p{Cc}]/u.test(rawPath);
}

/**
 * 전역 루트 경로와 프로젝트 하위 폴더를 결합해 히스토리 베이스 경로를 계산합니다.
 */
export function resolveHistoryBasePath(rawHistoryPath?: string, rawSubfolder?: string): string {
	const root = normalizeHistoryRootPath(rawHistoryPath);
	const sub = sanitizeHistorySubfolder(rawSubfolder);
	return sub ? normalizePath(`${root}/${sub}`) : root;
}

/**
 * 전역 루트·프로젝트 하위 폴더·날짜 포맷을 반영한 미리보기 경로를 계산합니다.
 * 포맷이 유효하지 않으면 isFormatValid=false와 함께 basePath를 반환합니다.
 */
export function formatHistoryFolderPreview(
	rawHistoryPath?: string,
	rawSubfolder?: string,
	folderFormat?: string,
	date: Date = new Date(),
): HistoryPreviewResult {
	const basePath = resolveHistoryBasePath(rawHistoryPath, rawSubfolder);
	const fmt = folderFormat ?? '';
	const validation = validateDateTemplate(fmt);
	if (!validation.valid) {
		return {
			basePath,
			resolvedPath: basePath,
			isFormatValid: false,
		};
	}
	const dateSub = resolveDateTemplate(fmt, date);
	const resolvedPath = dateSub ? normalizePath(`${basePath}/${dateSub}`) : basePath;
	return {
		basePath,
		resolvedPath,
		isFormatValid: true,
	};
}
