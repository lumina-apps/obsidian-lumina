/**
 * voicePrompts.ts
 *
 * 3종 출력 템플릿(깔끔 정리 / 회의록 / 그대로 받아쓰기) 시스템 프롬프트 빌더,
 * Granola형 사용자 메모 diff 추출, 최종 마크다운 조립 유틸리티를 제공합니다.
 */

import { t } from '../../../shared/locales/helpers';
import type { ChatMessage } from '../../../shared/types/llm.types';
import type { TranscriptSegment, VoiceTemplateId } from '../../../shared/types/voice.types';
import { stripThinkTags } from '../../../shared/utils/llmTextSanitizer';

/**
 * 초 단위 시간을 MM:SS 또는 HH:MM:SS 문자열로 포맷합니다.
 */
export function formatTimestamp(seconds: number): string {
	const safe = Math.max(0, Math.floor(seconds));
	const hrs = Math.floor(safe / 3600);
	const mins = Math.floor((safe % 3600) / 60);
	const secs = safe % 60;
	const mm = String(mins).padStart(2, '0');
	const ss = String(secs).padStart(2, '0');
	if (hrs > 0) {
		return `${String(hrs).padStart(2, '0')}:${mm}:${ss}`;
	}
	return `${mm}:${ss}`;
}

/**
 * 녹음 시작 시점과 종료 시점의 노트 내용을 비교하여
 * 사용자가 녹음 도중 직접 타이핑한 메모/키워드 변경분을 추출합니다 (Granola형 병합용).
 */
export function extractUserMemoDiff(beforeText: string, afterText: string): string {
	if (!afterText || afterText === beforeText) return '';
	const beforeLines = new Set(
		beforeText
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter(Boolean),
	);

	const addedLines: string[] = [];
	for (const line of afterText.split(/\r?\n/)) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (!beforeLines.has(trimmed)) {
			addedLines.push(line);
		}
	}

	return addedLines.join('\n').trim();
}

function getTemplateInstruction(templateId: VoiceTemplateId, summaryTitle: string): string {
	switch (templateId) {
		case 'meeting':
			return [
				'Output template: Meeting / Lecture Notes.',
				`1. Start with a concise callout: > [!summary] ${summaryTitle} (2-4 bullet points).`,
				'2. Organize key topics under clear ## headings with concise bullet points.',
				'3. Extract concrete tasks or follow-ups under a ## Action Items heading using Markdown checkboxes (- [ ] ...). Omit if none exist.',
				'4. Preserve key numbers, decisions, names, and technical terms accurately.',
			].join('\n');
		case 'verbatim':
			return [
				'Output template: Verbatim Cleanup.',
				'1. Preserve ALL spoken ideas and sentences faithfully without summarizing or omitting details.',
				'2. Only remove speech disfluencies/fillers (e.g., "um", "uh", "어...", "그니까") and fix punctuation, spacing, paragraph breaks, and misspelled proper nouns.',
			].join('\n');
		case 'clean':
		default:
			return [
				'Output template: Clean Smart Note.',
				`1. Start with a concise callout: > [!summary] ${summaryTitle} (1-3 bullet points).`,
				'2. Remove filler words, repetitions, and rambling, and restructure the content into logical ## headings and crisp bullet points or paragraphs.',
				'3. Fix any speech-to-text typos using the provided vocabulary and note context.',
			].join('\n');
	}
}

export interface BuildVoicePromptParams {
	/** 선택한 출력 템플릿 */
	templateId: VoiceTemplateId;
	/** 전체 STT 원문 */
	rawTranscript: string;
	/** 타임스탬프 세그먼트 목록 */
	segments: TranscriptSegment[];
	/** 녹음 중 사용자가 노트에 직접 작성한 메모 변경분 */
	userMemoDiff?: string;
	/** 현재 대상 노트 제목 */
	activeNoteTitle?: string;
	/** 사용자 고유명사 단어장 */
	customVocabulary?: readonly string[];
	/** 볼트 내 기존 노트 제목 일부 (고유명사/문맥 교정용) */
	vaultNoteTitles?: readonly string[];
	/** 응답 언어 설정 ('auto' 또는 ISO 코드) */
	responseLanguage?: string;
}

/**
 * LLM 노트 구조화를 위한 system/user 메시지 배열을 생성합니다.
 */
export function buildVoiceFormattingMessages(params: BuildVoicePromptParams): ChatMessage[] {
	const summaryTitle = t('voiceNote.output.summaryTitle');
	const templateGuide = getTemplateInstruction(params.templateId, summaryTitle);

	const languageRule =
		params.responseLanguage && params.responseLanguage !== 'auto'
			? `Write the formatted note in language code "${params.responseLanguage}", preserving English technical terms and proper nouns as appropriate.`
			: 'Write the formatted note in the primary language of the spoken transcript, preserving English technical terms and proper nouns accurately.';

	const systemLines = [
		'You are an expert Obsidian knowledge assistant converting spoken transcripts into clean, structured Markdown notes.',
		templateGuide,
		languageRule,
		'Do NOT wrap the output in ```markdown code fences. Output raw Markdown directly.',
		'Do NOT invent facts that were not mentioned in the transcript or user notes.',
	];

	if (params.userMemoDiff?.trim()) {
		systemLines.push(
			'The user also typed brief live notes (<user_notes>) while recording. Treat those notes as the structural backbone/priorities and enrich them seamlessly with full context and details from <transcript>.',
		);
	}

	const userSections: string[] = [];

	if (params.activeNoteTitle?.trim()) {
		userSections.push(`<active_note_title>${params.activeNoteTitle.trim()}</active_note_title>`);
	}

	if (params.customVocabulary && params.customVocabulary.length > 0) {
		userSections.push(`<custom_vocabulary>\n${params.customVocabulary.join(', ')}\n</custom_vocabulary>`);
	}

	if (params.vaultNoteTitles && params.vaultNoteTitles.length > 0) {
		userSections.push(
			`<vault_note_titles>\n${params.vaultNoteTitles.slice(0, 40).join(', ')}\n</vault_note_titles>`,
		);
	}

	if (params.userMemoDiff?.trim()) {
		userSections.push(`<user_notes>\n${params.userMemoDiff.trim()}\n</user_notes>`);
	}

	const timelineText =
		params.segments.length > 0
			? params.segments.map((s) => `[${formatTimestamp(s.startSec)}] ${s.text}`).join('\n')
			: params.rawTranscript;

	userSections.push(`<transcript>\n${timelineText.trim()}\n</transcript>`);

	return [
		{ role: 'system', content: systemLines.join('\n\n') },
		{ role: 'user', content: userSections.join('\n\n') },
	];
}

/**
 * LLM 응답에서 사고 과정 태그(<think>)와 불필요한 최외곽 마크다운 코드 펜스를 제거합니다.
 */
export function cleanFormattedVoiceOutput(rawOutput: string): string {
	let cleaned = stripThinkTags(rawOutput).trim();
	const fenceMatch = cleaned.match(/^```(?:markdown|md)?\s*\r?\n([\s\S]*?)\r?\n```$/i);
	if (fenceMatch) {
		cleaned = fenceMatch[1].trim();
	}
	return cleaned;
}

export interface AssembleVoiceMarkdownParams {
	/** LLM이 정리한 본문 (또는 폴백 원문) */
	formattedBody: string;
	/** 타임스탬프 포함 세그먼트 목록 */
	segments: TranscriptSegment[];
	/** 전체 원문 */
	rawTranscript: string;
	/** 볼트에 저장된 오디오 파일 경로 (없으면 null) */
	audioVaultPath: string | null;
	/** 하단 원본 스크립트 접기 콜아웃 포함 여부 */
	includeRawTranscript: boolean;
}

/**
 * 오디오 임베드, AI 정리 본문, 타임스탬프 연동 원본 스크립트 콜아웃을 하나의 마크다운 블록으로 조립합니다.
 */
export function assembleVoiceNoteMarkdown(params: AssembleVoiceMarkdownParams): string {
	const parts: string[] = [];

	if (params.audioVaultPath) {
		parts.push(`![[${params.audioVaultPath}]]`);
	}

	const body = cleanFormattedVoiceOutput(params.formattedBody);
	if (body) {
		parts.push(body);
	}

	if (params.includeRawTranscript && (params.segments.length > 0 || params.rawTranscript.trim())) {
		const title = t('voiceNote.output.rawTranscriptTitle');
		const calloutLines: string[] = [`> [!note]- ${title}`];

		if (params.segments.length > 0) {
			for (const seg of params.segments) {
				const text = seg.text.trim();
				if (!text) continue;
				const sec = Math.max(0, Math.floor(seg.startSec));
				const label = formatTimestamp(sec);
				calloutLines.push(`> - **[${label}](#lumina-ts=${sec})** ${text}`);
			}
		} else {
			for (const line of params.rawTranscript.trim().split(/\r?\n/)) {
				calloutLines.push(`> ${line}`);
			}
		}

		parts.push(calloutLines.join('\n'));
	}

	return parts.join('\n\n').trim();
}
