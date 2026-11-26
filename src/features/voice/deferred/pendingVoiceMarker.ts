/**
 * pendingVoiceMarker.ts
 *
 * 모바일에서 볼트에 저장한 음성 녹음과 데스크톱 동기화 후 변환 대기 상태를
 * 마크다운 노트 본문 내 인라인 주석 마커로 기록·파싱·제자리 치환하는 순수 유틸리티입니다.
 */

import { normalizePath } from 'obsidian';
import type { VoiceTemplateId } from '../../../shared/types/voice.types';

/** 대기 마커 빠른 사전 판별용 시작 주석 접두사 */
export const PENDING_VOICE_MARKER_PREFIX = '<!-- lumina-voice:pending';

const PENDING_BLOCK_REGEX =
	/<!--\s*lumina-voice:pending\s+([^>]*?)-->([\s\S]*?)<!--\s*\/lumina-voice:pending\s*-->/g;

const ATTR_REGEX = /([a-zA-Z0-9_-]+)="([^"]*)"/g;

const VALID_TEMPLATES: ReadonlySet<VoiceTemplateId> = new Set<VoiceTemplateId>([
	'clean',
	'meeting',
	'verbatim',
]);

/** 파싱된 단일 대기 음성 마커 정보 */
export interface ParsedPendingVoiceMarker {
	/** 마커 고유 식별자 */
	id: string;
	/** 마커가 포함된 노트 경로 */
	notePath: string;
	/** 정규화된 볼트 오디오 파일 경로 */
	audioPath: string;
	/** 적용할 출력 템플릿 ID */
	templateId: VoiceTemplateId;
	/** 노트 본문에서 매칭된 전체 블록 문자열 */
	fullMatch: string;
	/** 매칭 시작 오프셋 */
	startIndex: number;
	/** 매칭 종료 오프셋 */
	endIndex: number;
}

/** 대기 음성 블록 생성 파라미터 */
export interface BuildPendingVoiceBlockParams {
	/** 마커 고유 식별자 */
	id: string;
	/** 볼트에 저장된 오디오 파일 경로 */
	audioVaultPath: string;
	/** 적용 예정 출력 템플릿 ID */
	templateId: VoiceTemplateId;
	/** 콜아웃 안내 문구 */
	pendingNoticeText: string;
}

function escapeAttrValue(value: string): string {
	return value
		.replace(/[\r\n]+/g, ' ')
		.replace(/"/g, '&quot;')
		.replace(/-->/g, '--&gt;')
		.trim();
}

function unescapeAttrValue(value: string): string {
	return value
		.replace(/&quot;/g, '"')
		.replace(/--&gt;/g, '-->')
		.trim();
}

function normalizeTemplateId(raw: string | undefined): VoiceTemplateId {
	if (raw && VALID_TEMPLATES.has(raw as VoiceTemplateId)) {
		return raw as VoiceTemplateId;
	}
	return 'clean';
}

/**
 * 한 노트 안에 여러 개의 대기 녹음 블록이 들어가도 충돌하지 않도록 고유 마커 ID를 생성합니다.
 */
export function generatePendingVoiceId(): string {
	const rand = Math.random().toString(36).slice(2, 8);
	return `v_${Date.now()}_${rand}`;
}

/**
 * 오디오 임베드와 변환 대기 안내 콜아웃을 포함한 인라인 대기 마커 블록을 생성합니다.
 */
export function buildPendingVoiceBlock(params: BuildPendingVoiceBlockParams): string {
	const safeId = escapeAttrValue(params.id);
	const normalizedAudio = normalizePath(params.audioVaultPath);
	const safeAudio = escapeAttrValue(normalizedAudio);
	const safeTemplate = normalizeTemplateId(params.templateId);
	const safeNotice = params.pendingNoticeText.replace(/[\r\n]+/g, ' ').trim();

	return [
		`<!-- lumina-voice:pending id="${safeId}" audio="${safeAudio}" template="${safeTemplate}" -->`,
		`![[${normalizedAudio}]]`,
		`> [!info] ${safeNotice}`,
		'<!-- /lumina-voice:pending -->',
	].join('\n');
}

/**
 * 마크다운 본문에서 유효한 대기 음성 마커 목록을 추출합니다.
 */
export function parsePendingVoiceMarkers(
	notePath: string,
	content: string,
): ParsedPendingVoiceMarker[] {
	if (!content || !content.includes(PENDING_VOICE_MARKER_PREFIX)) {
		return [];
	}

	const results: ParsedPendingVoiceMarker[] = [];
	const blockRegex = new RegExp(PENDING_BLOCK_REGEX.source, 'g');
	let match: RegExpExecArray | null = blockRegex.exec(content);

	while (match !== null) {
		const rawAttrs = match[1] ?? '';
		const attrs: Record<string, string> = {};
		const attrRegex = new RegExp(ATTR_REGEX.source, 'g');
		let attrMatch: RegExpExecArray | null = attrRegex.exec(rawAttrs);
		while (attrMatch !== null) {
			attrs[attrMatch[1]] = unescapeAttrValue(attrMatch[2]);
			attrMatch = attrRegex.exec(rawAttrs);
		}

		const id = attrs.id?.trim();
		const rawAudio = attrs.audio?.trim();
		if (id && rawAudio) {
			results.push({
				id,
				notePath,
				audioPath: normalizePath(rawAudio),
				templateId: normalizeTemplateId(attrs.template),
				fullMatch: match[0],
				startIndex: match.index,
				endIndex: match.index + match[0].length,
			});
		}

		match = blockRegex.exec(content);
	}

	return results;
}

/**
 * 노트 본문에서 지정된 마커 ID에 해당하는 대기 블록만 최종 마크다운으로 제자리 치환합니다.
 */
export function replacePendingVoiceBlock(
	content: string,
	markerId: string,
	replacementMarkdown: string,
): { updated: string; replaced: boolean } {
	const markers = parsePendingVoiceMarkers('', content);
	const target = markers.find((m) => m.id === markerId);
	if (!target) {
		return { updated: content, replaced: false };
	}

	const replacement = replacementMarkdown.trim();
	const updated =
		content.slice(0, target.startIndex) + replacement + content.slice(target.endIndex);

	return { updated, replaced: true };
}
