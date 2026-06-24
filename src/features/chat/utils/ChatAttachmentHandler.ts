/**
 * 모든 ContextAttachment 타입을 텍스트/이미지(base64)로 변환하는 핸들러.
 */

import { App, TFile, TFolder, MarkdownView, requestUrl } from 'obsidian';
import { DocumentParserRouter, SUPPORTED_EXTENSIONS } from '../../rag/parsers/DocumentParserRouter';
import type { ContextAttachment } from '../../../shared/types/chat.types';
import type LuminaPlugin from '../../../main';
import { t } from '../../../shared/locales/helpers';

export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const MAX_TEXT_LENGTH = 100000; // 대략적인 글자 수 제한 (초과 시 잘림)
const MAX_TAG_FILES = 5;       // 태그 검색 시 최대 파일 수

export interface ParsedAttachment {
	type: 'text' | 'image';
	content: string; // text 내용 또는 base64 이미지 url
}

// canvas 파일 구조 타입
interface CanvasNode {
	type: string;
	text?: string;
}
interface CanvasData {
	nodes?: CanvasNode[];
}

export class ChatAttachmentHandler {
	/**
	 * 단일 첨부 항목을 분석하여 텍스트 또는 이미지(base64)로 변환한다.
	 * 지원하지 않는 타입이거나 파싱 실패 시 null 반환.
	 */
	static async parseAttachment(app: App, att: ContextAttachment, plugin?: LuminaPlugin): Promise<ParsedAttachment | null> {
		try {
			switch (att.type) {
				case 'file':
					return await this.parseFileAttachment(app, att, plugin);

				case 'url':
					return await this.parseUrlAttachment(att);

				case 'external_file':
					return this.parseExternalFileAttachment(att);

				case 'folder':
					return await this.parseFolderAttachment(app, att);

				case 'selection':
					return this.parseSelectionAttachment(app);

				case 'active_note':
					return await this.parseActiveNoteAttachment(app);

				case 'canvas':
					return await this.parseCanvasAttachment(app, att);

				case 'tag':
					return await this.parseTagAttachment(app, att);

				default:
					return null;
			}
		} catch (error) {
			console.warn(`[Lumina] 첨부파일 파싱 실패: ${att.name}`, error);
			return null;
		}
	}

	// ─── 개별 타입별 파싱 메서드 ─────────────────────────────────────────────────

	private static async parseFileAttachment(app: App, att: ContextAttachment, plugin?: LuminaPlugin): Promise<ParsedAttachment | null> {
		const file = app.vault.getAbstractFileByPath(att.path);
		if (!(file instanceof TFile)) return null;

		const ext = file.extension.toLowerCase();

		// 1. 이미지 파일 처리
		if (IMAGE_EXTENSIONS.has(ext)) {
			const buffer = await app.vault.readBinary(file);
			const base64 = this.arrayBufferToBase64(buffer);
			const mimeType = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
			return { type: 'image', content: `data:${mimeType};base64,${base64}` };
		}

		// 2. 문서 파일 처리 (파서 라우터 재사용)
		if (SUPPORTED_EXTENSIONS.has(ext)) {
			let text = '';
			if (['pdf', 'docx', 'xlsx', 'xls'].includes(ext)) {
				if (plugin?.embeddingWorker) {
					const buffer = await app.vault.readBinary(file);
					text = await plugin.embeddingWorker.parse(buffer, ext);
				} else {
					console.warn('Worker not ready to parse binary file:', file.name);
				}
			} else {
				const textContent = await app.vault.read(file);
				text = await DocumentParserRouter.parseText(textContent, ext);
			}
			return this.createTextPayload(`[첨부 파일: ${att.name}]\n${text}`);
		}

		// 지원하지 않는 확장자
		return null;
	}

	private static async parseUrlAttachment(att: ContextAttachment): Promise<ParsedAttachment | null> {
		const response = await requestUrl({ url: att.path });
		let html = response.text;

		// 1. 본문과 무관한 블록 전체 제거 (태그 + 내용 포함)
		html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
		html = html.replace(/<style[\s\S]*?<\/style>/gi, '');
		html = html.replace(/<nav[\s\S]*?<\/nav>/gi, '');
		html = html.replace(/<footer[\s\S]*?<\/footer>/gi, '');
		html = html.replace(/<header[\s\S]*?<\/header>/gi, '');
		html = html.replace(/<aside[\s\S]*?<\/aside>/gi, '');

		// 2. 나머지 HTML 태그 제거
		html = html.replace(/<[^>]*>/gm, '');

		// 3. 주요 HTML 엔티티 디코딩
		html = html
			.replace(/&nbsp;/g, ' ')
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&quot;/g, '"')
			.replace(/&#39;/g, "'");

		// 4. 공백 정리
		html = html.replace(/\s+/g, ' ').trim();

		return this.createTextPayload(`[외부 웹페이지: ${att.path}]\n${html}`);
	}

	private static parseExternalFileAttachment(att: ContextAttachment): ParsedAttachment | null {
		if (!att.content) return null;
		// 이미 UI에서 파싱되어 내용이 채워진 경우
		if (att.content.startsWith('data:image/')) {
			return { type: 'image', content: att.content };
		}
		return this.createTextPayload(`[외부 파일: ${att.name}]\n${att.content}`);
	}

	private static async parseFolderAttachment(app: App, att: ContextAttachment): Promise<ParsedAttachment | null> {
		const folder = app.vault.getAbstractFileByPath(att.path);
		if (!(folder instanceof TFolder)) return null;

		let folderContent = t('settings.chat.context.folderFiles', { name: att.name }) + '\n';
		for (const child of folder.children) {
			if (child instanceof TFile && child.extension === 'md') {
				const content = await app.vault.read(child);
				folderContent += `--- ${child.basename} ---\n${content}\n\n`;
			}
		}
		return this.createTextPayload(folderContent);
	}

	private static parseSelectionAttachment(app: App): ParsedAttachment | null {
		const activeView = app.workspace.getActiveViewOfType(MarkdownView);
		// @ts-ignore
		const selection = activeView?.editor?.getSelection();
		if (!selection) return null;
		return this.createTextPayload(`[${t('uiMessages.qaSelectedText')}]\n${selection}`);
	}

	private static async parseActiveNoteAttachment(app: App): Promise<ParsedAttachment | null> {
		const activeFile = app.workspace.getActiveFile();
		if (!activeFile) return null;
		const content = await app.vault.read(activeFile);
		return this.createTextPayload(
			t('settings.chat.context.activeNotePrefix', { name: activeFile.basename }) + '\n' + content,
		);
	}

	private static async parseCanvasAttachment(app: App, att: ContextAttachment): Promise<ParsedAttachment | null> {
		const file = app.vault.getAbstractFileByPath(att.path);
		if (!(file instanceof TFile)) return null;

		const content = await app.vault.read(file);
		try {
			const canvasData = JSON.parse(content) as CanvasData;
			let canvasText = t('settings.chat.context.canvasFile', { name: att.name }) + '\n';
			canvasData.nodes?.forEach((node) => {
				if (node.type === 'text' && node.text) {
					canvasText += `- ${node.text}\n`;
				}
			});
			return this.createTextPayload(canvasText);
		} catch (e) {
			console.warn('Failed to parse canvas', e);
			return null;
		}
	}

	private static async parseTagAttachment(app: App, att: ContextAttachment): Promise<ParsedAttachment | null> {
		const files = app.vault.getMarkdownFiles();
		let tagContent = t('settings.chat.context.tagFiles', { name: att.name }) + '\n';
		let count = 0;

		for (const file of files) {
			const cache = app.metadataCache.getFileCache(file);
			const tags = cache?.tags;
			const fmTags = cache?.frontmatter?.tags as string[] | undefined;
			const hasTag =
				(Array.isArray(tags) && tags.some(tg => tg.tag === att.name)) ||
				(Array.isArray(fmTags) && fmTags.includes(att.name.replace('#', '')));

			if (hasTag) {
				const content = await app.vault.read(file);
				tagContent += `--- ${file.basename} ---\n${content}\n\n`;
				count++;
				if (count >= MAX_TAG_FILES) break;
			}
		}

		return this.createTextPayload(tagContent);
	}

	// ─── 공통 유틸 ───────────────────────────────────────────────────────────────

	/**
	 * 첨부파일 배열 전체를 처리하여 컨텍스트 텍스트와 멀티모달 이미지 목록을 반환한다.
	 *
	 * @returns { attachmentContext, multimodalImages }
	 */
	static async buildAttachmentContext(
		app: App,
		attachments: ContextAttachment[],
		plugin?: LuminaPlugin,
		options?: { skipFolders?: boolean }
	): Promise<{ attachmentContext: string; multimodalImages: string[] }> {
		let attachmentContext = '';
		const multimodalImages: string[] = [];

		for (const att of attachments) {
			if (options?.skipFolders && att.type === 'folder') {
				continue;
			}
			try {
				const parsed = await this.parseAttachment(app, att, plugin);
				if (!parsed) continue;

				if (parsed.type === 'image') {
					multimodalImages.push(parsed.content);
				} else {
					attachmentContext += `${parsed.content}\n\n`;
				}
			} catch (e) {
				console.warn(`Failed to read attachment: ${att.name}`, e);
			}
		}

		return { attachmentContext, multimodalImages };
	}

	private static createTextPayload(text: string): ParsedAttachment {
		if (text.length > MAX_TEXT_LENGTH) {
			console.warn('[Lumina] 첨부 텍스트가 너무 길어 일부 잘렸습니다.');
			return { type: 'text', content: text.substring(0, MAX_TEXT_LENGTH) + '\n\n... (내용이 너무 길어 생략됨)' };
		}
		return { type: 'text', content: text };
	}

	private static arrayBufferToBase64(buffer: ArrayBuffer): string {
		let binary = '';
		const bytes = new Uint8Array(buffer);
		const len = bytes.byteLength;
		for (let i = 0; i < len; i++) {
			binary += String.fromCharCode(bytes[i]);
		}
		// 모바일 환경(Capacitor)과 데스크톱 모두에서 btoa 사용 가능
		return btoa(binary);
	}
}
