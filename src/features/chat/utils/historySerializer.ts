import type { TFile } from 'obsidian';
import type { ChatSession, ContextAttachment } from '../../../shared/types/chat.types';
import { sanitizeDisplayContent } from '../../../shared/utils/llmTextSanitizer';
import { t } from '../../../shared/locales/helpers';

/** 히스토리 파일의 frontmatter 메타데이터 인터페이스 */
export interface HistoryFrontmatter {
	id?: string;
	title?: string;
	created?: string | number;
	updated?: string | number;
	provider?: string;
	model?: string;
}

/** UTF-8 문자열을 Base64 문자열로 인코딩 (웹 표준 TextEncoder 사용) */
export function utf8ToBase64(str: string): string {
	const bytes = new TextEncoder().encode(str);
	let binary = '';
	const len = bytes.length;
	const CHUNK_SIZE = 8192;
	for (let i = 0; i < len; i += CHUNK_SIZE) {
		binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK_SIZE, len)));
	}
	return btoa(binary);
}

/** Base64 문자열을 UTF-8 문자열로 디코딩 (웹 표준 TextDecoder 사용) */
export function base64ToUtf8(base64: string): string {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i++) {
		bytes[i] = binary.charCodeAt(i);
	}
	return new TextDecoder().decode(bytes);
}

/** frontmatter 블록(파일 첫 번째 --- ... ---)의 모든 키-값을 1회 정규식으로 추출한다. */
export function extractFrontmatter(text: string): Record<string, string> | null {
	const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/m);
	if (!fmMatch) return null;
	const result: Record<string, string> = {};
	for (const line of fmMatch[1].split(/\r?\n/)) {
		const colonIdx = line.indexOf(':');
		if (colonIdx !== -1) {
			const key = line.slice(0, colonIdx).trim();
			const val = line.slice(colonIdx + 1).trim();
			result[key] = val;
		}
	}
	return result;
}

/**
 * 파일 내용에서 frontmatter 블록을 추출하여 파싱한다.
 * frontmatter 블록이 없거나 id가 없는 경우 null 반환.
 */
export function parseFrontmatterFromContent(content: string, file: TFile): HistoryFrontmatter | null {
	const fm = extractFrontmatter(content);
	if (!fm || !fm.id) return null;

	let parsedTitle = t('chat.newChat');
	if (fm.title) {
		try {
			parsedTitle = JSON.parse(fm.title) as string;
		} catch {
			parsedTitle = fm.title.replace(/^["']|["']$/g, '');
		}
	}

	const modelVal = fm.model ? fm.model.replace(/^["']|["']$/g, '') : '';
	const providerVal = fm.provider ? fm.provider.replace(/^["']|["']$/g, '') : '';

	return {
		id: fm.id,
		title: parsedTitle,
		created: fm.created ?? file.stat.ctime,
		updated: fm.updated ?? file.stat.mtime,
		model: modelVal,
		provider: providerVal,
	};
}

/** 주어진 값에서 유효한 timestamp를 반환한다. 없으면 fallback 값 사용 */
export function parseTimestamp(value: string | number | undefined, fallback: number): number {
	if (value == null) return fallback;
	if (typeof value === 'number') return value;
	const parsed = new Date(value).getTime();
	return isNaN(parsed) ? fallback : parsed;
}

/**
 * 파일명에서 YYMMDD_HHMM - title.md 패턴을 파싱하여 timestamp를 추출한다.
 * 실패하면 null 반환.
 */
export function parseTimestampFromFilename(filename: string): number | null {
	const match = filename.match(/^(\d{2})(\d{2})(\d{2})_(\d{2})(\d{2})\s*-\s*.+\.md$/);
	if (!match) return null;
	const [, yy, mm, dd, hh, min] = match;
	const date = new Date(
		Number(`20${yy}`),
		Number(mm) - 1,
		Number(dd),
		Number(hh),
		Number(min),
	);
	return isNaN(date.getTime()) ? null : date.getTime();
}

/**
 * 첨부파일에서 민감한 content 필드(base64 이미지, 파일 본문 등)를 제거한다.
 * path, name, type 등 메타데이터만 유지하여 .md 파일 노출을 최소화한다.
 */
export function sanitizeAttachmentsForStorage(
	attachments: ContextAttachment[] | undefined,
): ContextAttachment[] | undefined {
	if (!attachments) return undefined;
	return attachments.map(att => {
		const rest = { ...att };
		delete rest.content;
		return rest;
	});
}

/** 세션을 Markdown 및 숨김 Base64 JSON(V2) 포맷으로 직렬화 */
export function serializeSession(session: ChatSession): string {
	// 생각 과정(<think>...</think>) 제거 및 첨부파일 민감 정보 제거를 위해 복제본 생성
	const cleanSession = {
		...session,
		messages: session.messages.map(m => ({
			...m,
			content: m.role === 'assistant' ? sanitizeDisplayContent(m.content) : m.content,
			// base64 이미지 등 무거운 content 필드를 파일에 저장하지 않음
			attachments: sanitizeAttachmentsForStorage(m.attachments),
		}))
	};

	const frontmatter = [
		'---',
		`id: ${cleanSession.id}`,
		`title: ${JSON.stringify(cleanSession.title)}`,
		`provider: ${cleanSession.providerId}`,
		`model: "${cleanSession.modelId.replace(/:/g, '_')}"`,
		`created: ${new Date(cleanSession.createdAt).toISOString()}`,
		`updated: ${new Date(cleanSession.updatedAt).toISOString()}`,
		'---',
		'',
	].join('\n');

	const body = cleanSession.messages
		.filter(m => m.role !== 'system')
		.map(m => {
			const label = m.role === 'user' ? '**👤 You**' : `**✦ Lumina** _(${m.model ?? ''})_`;
			const time = new Date(m.timestamp).toLocaleTimeString();
			return `${label} · ${time}\n\n${m.content}\n`;
		})
		.join('\n---\n\n');

	// V2: base64 인코딩으로 JSON 내부 --> 충돌 방지
	const jsonStr = JSON.stringify(cleanSession);
	const encoded = utf8ToBase64(jsonStr);
	const rawDataBlock = `\n\n<!-- LUMINA_HISTORY_DATA_V2: ${encoded} -->\n`;

	return frontmatter + body + rawDataBlock;
}
