import { App, TFile, requestUrl } from 'obsidian';
import { DocumentParserRouter, SUPPORTED_EXTENSIONS } from '../../rag/parsers/DocumentParserRouter';
import type { ContextAttachment } from '../../../shared/types/chat.types';
import type LuminaPlugin from '../../../main';

export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif']);
const MAX_TEXT_LENGTH = 100000; // 대략적인 글자 수 제한 (초과 시 잘림)

export interface ParsedAttachment {
	type: 'text' | 'image';
	content: string; // text 내용 또는 base64 이미지 url
}

export class ChatAttachmentHandler {
	/**
	 * 첨부 파일을 분석하여 텍스트 또는 이미지(base64)로 변환합니다.
	 */
	static async parseAttachment(app: App, att: ContextAttachment, plugin?: LuminaPlugin): Promise<ParsedAttachment | null> {
		try {
			if (att.type === 'file') {
				const file = app.vault.getAbstractFileByPath(att.path);
				if (file instanceof TFile) {
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
			}
			else if (att.type === 'url') {
				const response = await requestUrl({ url: att.path });
				// 간단한 HTML 태그 제거 및 텍스트 추출
				const textContent = response.text.replace(/<[^>]*>?/gm, '').replace(/\s+/g, ' ').trim();
				return this.createTextPayload(`[외부 웹페이지: ${att.path}]\n${textContent}`);
			}
			else if (att.type === 'external_file' && att.content) {
				// 이미 UI에서 파싱되어 내용이 채워진 경우
				if (att.content.startsWith('data:image/')) {
					return { type: 'image', content: att.content };
				}
				return this.createTextPayload(`[외부 파일: ${att.name}]\n${att.content}`);
			}
			// 기타(폴더, 선택, 현재 노트, 캔버스, 태그)는 기존 chatController의 로직을 사용하거나 여기서 처리 가능합니다.
			// 복잡한 로직은 chatController 쪽에 남아있게 하고, 여기서는 명시적인 file/url 파싱만 전담합니다.
		} catch (error) {
			console.warn(`[Lumina] 첨부파일 파싱 실패: ${att.name}`, error);
		}
		
		return null;
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
