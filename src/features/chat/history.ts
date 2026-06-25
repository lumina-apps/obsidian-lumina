import { normalizePath, type App, TFolder, TFile } from 'obsidian';
import type { ChatSession, UIChatMessage } from '../../shared/types/chat.types';
import type { LLMProviderConfig } from '../../shared/types/settings.types';
/** 특정 디렉토리 내 .md 파일만 가져온다 (vault 전체 스캔 방지) */
function getHistoryFiles(app: App, basePath: string): TFile[] {
	const normalBase = normalizePath(basePath.replace(/[/\\]+$/, ''));
	const folder = app.vault.getAbstractFileByPath(normalBase);
	const files: TFile[] = [];
	if (folder instanceof TFolder) {
		for (const child of folder.children) {
			if (child instanceof TFile && child.extension === 'md') {
				files.push(child);
			}
		}
	}
	return files;
}

// ─── Save ─────────────────────────────────────────────────────────────────────

export async function saveSession(app: App, session: ChatSession, basePath: string): Promise<void> {
	// 파일명: YYMMDD_HHMM - [title]
	const dateObj = new Date(session.createdAt);
	const yy = String(dateObj.getFullYear()).slice(2);
	const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
	const dd = String(dateObj.getDate()).padStart(2, '0');
	const hh = String(dateObj.getHours()).padStart(2, '0');
	const min = String(dateObj.getMinutes()).padStart(2, '0');
	const safeTitle = session.title.replace(/[\\/:*?"<>|]/g, '_').trim();
	const filename = `${yy}${mm}${dd}_${hh}${min} - ${safeTitle}.md`;

	const normalBase = normalizePath(basePath.replace(/[/\\]+$/, ''));
	const filePath = normalizePath(`${normalBase}/${filename}`);

	const content = serializeSession(session);

	if (!(await app.vault.adapter.exists(normalBase))) {
		await app.vault.createFolder(normalBase);
	}

	// 기존 파일 탐색 (frontmatter id + 텍스트 폴백)
	const files = getHistoryFiles(app, normalBase);
	let existingFile = files.find(f => {
		const cache = app.metadataCache.getFileCache(f);
		return cache?.frontmatter?.id === session.id;
	});

	// 캐시 미동기 대비 텍스트 폴백
	if (!existingFile) {
		for (const f of files) {
			try {
				const text = await app.vault.cachedRead(f);
				const idMatch = text.match(/^id:\s*(.+)$/m);
				if (idMatch && idMatch[1].trim() === session.id) {
					existingFile = f;
					break;
				}
			} catch { /* ignore */ }
		}
	}

	if (existingFile) {
		if (existingFile.name !== filename) {
			await app.vault.rename(existingFile, filePath);
		}
		await app.vault.modify(existingFile, content);
	} else {
		await app.vault.create(filePath, content);
	}
}

// ─── Load & Delete ─────────────────────────────────────────────────────────────

/** 히스토리 폴더의 모든 .md 파일에서 세션 메타데이터 목록 반환 */
export async function loadSessionsList(app: App, basePath: string): Promise<ChatSession[]> {
	const normalBase = normalizePath(basePath.replace(/[/\\]+$/, ''));
	const folderExists = await app.vault.adapter.exists(normalBase);
	if (!folderExists) return [];

	const files = getHistoryFiles(app, normalBase);
	const sessions: ChatSession[] = [];

	interface HistoryFrontmatter {
		id?: string;
		title?: string;
		created?: string | number;
		updated?: string | number;
		provider?: string;
		model?: string;
	}

	for (const file of files) {
		const cache = app.metadataCache.getFileCache(file);
		let fm = cache?.frontmatter as HistoryFrontmatter | undefined;

		// 캐시 미동기 시 텍스트 파싱 폴백
		if (!fm) {
			try {
				const content = await app.vault.cachedRead(file);
				const idMatch = content.match(/^id:\s*(.+)$/m);
				if (idMatch) {
					const titleMatch = content.match(/^title:\s*(.+)$/m);
					const createdMatch = content.match(/^created:\s*(.+)$/m);
					const updatedMatch = content.match(/^updated:\s*(.+)$/m);
					const modelMatch = content.match(/^model:\s*(.+)$/m);
					const providerMatch = content.match(/^provider:\s*(.+)$/m);
					
					let parsedTitle = '새 대화';
					if (titleMatch) {
						try { parsedTitle = JSON.parse(titleMatch[1]) as string; } catch { parsedTitle = titleMatch[1].trim(); }
					}

					fm = {
						id: idMatch[1].trim(),
						title: parsedTitle,
						created: createdMatch ? createdMatch[1].trim() : file.stat.ctime,
						updated: updatedMatch ? updatedMatch[1].trim() : file.stat.mtime,
						model: modelMatch ? modelMatch[1].trim() : '',
						provider: providerMatch ? providerMatch[1].trim() : ''
					};
				}
			} catch { /* 읽기 실패 시 무시 */ }
		}

		if (fm && fm.id) {
			sessions.push({
				id: fm.id,
				title: fm.title || '새 대화',
				createdAt: new Date(fm.created || '').getTime(),
				updatedAt: new Date(fm.updated || '').getTime(),
				providerId: fm.provider || '',
				modelId: fm.model || '',
				messages: [], // 목록에서는 메시지 본문을 로드하지 않음 (최적화)
			});
		}
	}

	// 최신순 정렬
	return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 세션 파일에서 숨김 JSON을 파싱해 ChatSession(메시지 포함) 복원 */
export async function loadSession(app: App, sessionId: string, basePath: string): Promise<ChatSession | null> {
	const normalBase = normalizePath(basePath.replace(/[/\\]+$/, ''));
	const files = getHistoryFiles(app, normalBase);
	
	const file = files.find(f => {
		const cache = app.metadataCache.getFileCache(f);
		return cache?.frontmatter?.id === sessionId;
	});

	if (!file) return null;

	const content = await app.vault.read(file);
	
	// 숨김 JSON 데이터 블록에서 복원
	const match = content.match(/<!-- LUMINA_HISTORY_DATA:\s*([\s\S]*?)\s*-->/);
	if (match && match[1]) {
		try {
			const parsed = JSON.parse(match[1]) as ChatSession;
			return parsed;
		} catch (e) {
			console.error('Lumina: Failed to parse history JSON data', e);
		}
	}

	return null;
}

/** 세션 파일 삭제 */
export async function deleteSession(app: App, sessionId: string, basePath: string): Promise<boolean> {
	const normalBase = normalizePath(basePath.replace(/[/\\]+$/, ''));
	const files = getHistoryFiles(app, normalBase);
	
	const file = files.find(f => {
		const cache = app.metadataCache.getFileCache(f);
		return cache?.frontmatter?.id === sessionId;
	});

	if (file) {
		await app.fileManager.trashFile(file);
		return true;
	}
	return false;
}

// ─── Serialize ────────────────────────────────────────────────────────────────

function stripThoughtProcess(content: string): string {
	return content.replace(/<think>[\s\S]*?<\/think>\n*/gi, '').trim();
}

/**
 * 첨부파일에서 민감한 content 필드(base64 이미지, 파일 본문 등)를 제거한다.
 * path, name, type 등 메타데이터만 유지하여 .md 파일 노출을 최소화한다.
 */
function sanitizeAttachmentsForStorage(
	attachments: import('../../shared/types/chat.types').ContextAttachment[] | undefined,
): import('../../shared/types/chat.types').ContextAttachment[] | undefined {
	if (!attachments) return undefined;
	return attachments.map(att => {
		const rest = { ...att };
		delete rest.content;
		return rest;
	});
}

function serializeSession(session: ChatSession): string {
	// 생각 과정(<think>...</think>) 제거 및 첨부파일 민감 정보 제거를 위해 복제본 생성
	const cleanSession = {
		...session,
		messages: session.messages.map(m => ({
			...m,
			content: m.role === 'assistant' ? stripThoughtProcess(m.content) : m.content,
			// base64 이미지 등 무거운 content 필드를 파일에 저장하지 않음
			attachments: sanitizeAttachmentsForStorage(m.attachments),
		}))
	};

	const frontmatter = [
		'---',
		`id: ${cleanSession.id}`,
		`title: ${JSON.stringify(cleanSession.title)}`,
		`provider: ${cleanSession.providerId}`,
		`model: ${cleanSession.modelId}`,
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

	// 완벽한 복원을 위해 숨겨진 JSON 데이터를 맨 끝에 추가 (cleanSession 사용)
	const rawDataBlock = `\n\n<!-- LUMINA_HISTORY_DATA: ${JSON.stringify(cleanSession)} -->\n`;

	return frontmatter + body + rawDataBlock;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function generateTitle(messages: UIChatMessage[]): string {
	const first = messages.find(m => m.role === 'user');
	if (!first) return '새 대화';
	return first.content.slice(0, 40) + (first.content.length > 40 ? '…' : '');
}

export async function generateTitleWithLLM(
	messages: UIChatMessage[],
	providerConfig: LLMProviderConfig,
	modelId: string,
	settings: import('../../core/settings/settings.types').LuminaSettings
): Promise<string> {
	const first = messages.find(m => m.role === 'user');
	if (!first || !first.content.trim()) return '새 대화';

	// Prompt Injection 방지: 입력을 200자로 제한하고 큰따옴표 이스케이프
	const safeContent = first.content
		.slice(0, 200)
		.replace(/"/g, '\\"');
	const prompt = `다음 사용자의 메시지를 바탕으로 대화의 주제를 3~5단어 이내의 매우 짧은 제목으로 요약해줘. 따옴표나 부연 설명 없이 오직 제목 텍스트만 출력해야 해.\n\n사용자 메시지: "${safeContent}"`;

	try {
		const { createProvider } = await import('../../core/llm-providers/index');
		const provider = createProvider(providerConfig);
		const response = await provider.chat(
			[
				{ role: 'system', content: 'You are an AI that summarizes conversation titles.' },
				{ role: 'user', content: prompt }
			],
			{
				model: modelId,
				temperature: 0.3,
				maxOutputTokens: 20
			}
		);
		const title = response.content.replace(/["']/g, '').trim();
		return title || generateTitle(messages);
	} catch (e) {
		console.warn('Lumina: Failed to generate title with LLM, falling back to text extraction.', e);
		return generateTitle(messages);
	}
}

