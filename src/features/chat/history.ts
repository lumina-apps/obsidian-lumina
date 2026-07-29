import { normalizePath, type App, TFolder, TFile } from 'obsidian';
import { t } from '../../shared/locales/helpers';
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

	// 캐시 미동기 대비 텍스트 폴백 (frontmatter 블록 내에서만 id 검색)
	if (!existingFile) {
		for (const f of files) {
			try {
				const text = await app.vault.cachedRead(f);
				const idVal = parseFrontmatterBlock(text, 'id');
				if (idVal === session.id) {
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
interface HistoryFrontmatter {
	id?: string;
	title?: string;
	created?: string | number;
	updated?: string | number;
	provider?: string;
	model?: string;
}

/** frontmatter 블록(파일 첫 번째 --- ... ---) 내에서만 키를 찾는다. */
function parseFrontmatterBlock(text: string, key: string): string | undefined {
	const fmMatch = text.match(/^---\r?\n([\s\S]*?)\r?\n---/m);
	if (!fmMatch) return undefined;
	const fmText = fmMatch[1];
	const match = fmText.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
	return match?.[1]?.trim();
}

/**
 * 파일 내용에서 frontmatter 블록(첫 번째 --- ... ---)만 추출하여 파싱한다.
 * frontmatter 블록이 없거나 파싱해도 id를 찾지 못한 경우 null 반환.
 */
function parseFrontmatterFromContent(content: string, file: TFile): HistoryFrontmatter | null {
	const idVal = parseFrontmatterBlock(content, 'id');
	if (!idVal) return null;

	const titleVal = parseFrontmatterBlock(content, 'title');
	const createdVal = parseFrontmatterBlock(content, 'created');
	const updatedVal = parseFrontmatterBlock(content, 'updated');
	const modelVal = parseFrontmatterBlock(content, 'model');
	const providerVal = parseFrontmatterBlock(content, 'provider');

	let parsedTitle = t('chat.newChat');
	if (titleVal) {
		try { parsedTitle = JSON.parse(titleVal) as string; } catch { parsedTitle = titleVal; }
	}

	return {
		id: idVal,
		title: parsedTitle,
		created: createdVal ?? file.stat.ctime,
		updated: updatedVal ?? file.stat.mtime,
		model: modelVal ?? '',
		provider: providerVal ?? '',
	};
}

/** 주어진 값에서 유효한 timestamp를 반환한다. 없으면 fallback 값 사용 */
function parseTimestamp(value: string | number | undefined, fallback: number): number {
	if (value == null) return fallback;
	if (typeof value === 'number') return value;
	const parsed = new Date(value).getTime();
	return isNaN(parsed) ? fallback : parsed;
}

/**
 * 파일명에서 YYMMDD_HHMM - title.md 패턴을 파싱하여 timestamp를 추출한다.
 * 실패하면 null 반환.
 */
function parseTimestampFromFilename(filename: string): number | null {
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

export async function loadSessionsList(app: App, basePath: string): Promise<ChatSession[]> {
	const normalBase = normalizePath(basePath.replace(/[/\\]+$/, ''));
	const folderExists = await app.vault.adapter.exists(normalBase);
	if (!folderExists) return [];

	const files = getHistoryFiles(app, normalBase);
	const sessions: ChatSession[] = [];

	for (const file of files) {
		const cache = app.metadataCache.getFileCache(file);
		const cacheFm = cache?.frontmatter as HistoryFrontmatter | undefined;

		// 1차: metadataCache의 frontmatter 사용 (id가 있을 때만 유효)
		let fm: HistoryFrontmatter | undefined | null = (cacheFm && cacheFm.id) ? cacheFm : null;

		// 2차: frontmatter가 없거나 id가 누락된 경우 → 직접 파일 읽어서 frontmatter 블록만 파싱
		if (!fm) {
			try {
				const content = await app.vault.cachedRead(file);
				fm = parseFrontmatterFromContent(content, file);
			} catch { /* 읽기 실패 시 무시 */ }
		}

		if (fm && fm.id) {
			// 유효한 날짜가 없으면 파일 stat 또는 파일명에서 fallback
			const fileCreated = parseTimestamp(fm.created, file.stat.ctime);
			const fileUpdated = parseTimestamp(fm.updated, file.stat.mtime);

			// stat도 신뢰할 수 없으면 파일명에서 추출 시도
			const createdAt = fileCreated > 0 ? fileCreated
				: (parseTimestampFromFilename(file.name) ?? file.stat.ctime);
			const updatedAt = fileUpdated > 0 ? fileUpdated
				: (parseTimestampFromFilename(file.name) ?? file.stat.mtime);

			sessions.push({
				id: fm.id,
				title: fm.title || t('chat.newChat'),
				createdAt,
				updatedAt,
				providerId: fm.provider || '',
				modelId: fm.model || '',
				messages: [], // 목록에서는 메시지 본문을 로드하지 않음 (최적화)
			});
		}
	}

	// 최신순 정렬 (NaN 방어)
	return sessions.sort((a, b) => {
		const diff = b.updatedAt - a.updatedAt;
		return isNaN(diff) ? 0 : diff;
	});
}

/**
 * 파일 목록에서 sessionId와 일치하는 파일을 찾는다.
 * 1차: metadataCache의 frontmatter id
 * 2차: 직접 파일 읽어서 frontmatter 블록 내 id 검색
 */
async function findSessionFile(app: App, files: TFile[], sessionId: string): Promise<TFile | null> {
	// 1차: metadataCache
	const cached = files.find(f => {
		const cache = app.metadataCache.getFileCache(f);
		return cache?.frontmatter?.id === sessionId;
	});
	if (cached) return cached;

	// 2차: frontmatter 블록 내 id 검색 (캐시 미동기/부분 파싱 대응)
	for (const f of files) {
		try {
			const text = await app.vault.cachedRead(f);
			if (parseFrontmatterBlock(text, 'id') === sessionId) {
				return f;
			}
		} catch { /* ignore */ }
	}

	return null;
}

/** 세션 파일에서 숨김 JSON을 파싱해 ChatSession(메시지 포함) 복원 */
export async function loadSession(app: App, sessionId: string, basePath: string): Promise<ChatSession | null> {
	const normalBase = normalizePath(basePath.replace(/[/\\]+$/, ''));
	const files = getHistoryFiles(app, normalBase);
	
	const file = await findSessionFile(app, files, sessionId);
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
	
	const file = await findSessionFile(app, files, sessionId);
	if (file) {
		await app.fileManager.trashFile(file);
		return true;
	}
	return false;
}

// ─── Serialize ────────────────────────────────────────────────────────────────

import { sanitizeDisplayContent } from '../../shared/utils/llmTextSanitizer';

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

	// 완벽한 복원을 위해 숨겨진 JSON 데이터를 맨 끝에 추가 (cleanSession 사용)
	const rawDataBlock = `\n\n<!-- LUMINA_HISTORY_DATA: ${JSON.stringify(cleanSession)} -->\n`;

	return frontmatter + body + rawDataBlock;
}

// ─── Export ───────────────────────────────────────────────────────────────────

export async function exportSessionToMarkdown(app: App, session: ChatSession): Promise<void> {
	const dateObj = new Date(session.createdAt);
	const yy = String(dateObj.getFullYear()).slice(2);
	const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
	const dd = String(dateObj.getDate()).padStart(2, '0');
	const hh = String(dateObj.getHours()).padStart(2, '0');
	const min = String(dateObj.getMinutes()).padStart(2, '0');
	const safeTitle = session.title.replace(/[\\/:*?"<>|]/g, '_').trim();
	const filename = `${yy}${mm}${dd}_${hh}${min} - ${safeTitle}.md`;

	const exportFolder = normalizePath('Lumina Exports');
	const filePath = normalizePath(`${exportFolder}/${filename}`);

	if (!(await app.vault.adapter.exists(exportFolder))) {
		await app.vault.createFolder(exportFolder);
	}

	const body = session.messages
		.filter(m => m.role !== 'system')
		.map(m => {
			const label = m.role === 'user' ? '**👤 You**' : `**✦ Lumina** _(${m.model ?? ''})_`;
			const time = new Date(m.timestamp).toLocaleTimeString();
			const content = m.role === 'assistant' ? sanitizeDisplayContent(m.content) : m.content;
			return `${label} · ${time}\n\n${content}\n`;
		})
		.join('\n---\n\n');
	
	const header = `# ${session.title}\n\n- **Date**: ${dateObj.toLocaleString()}\n- **Model**: ${session.modelId || 'Unknown'}\n\n---\n\n`;
	const fullContent = header + body;

	let file: TFile;
	const existingFile = app.vault.getAbstractFileByPath(filePath);
	if (existingFile instanceof TFile) {
		file = existingFile;
		await app.vault.modify(file, fullContent);
	} else {
		file = await app.vault.create(filePath, fullContent);
	}

	await app.workspace.getLeaf('tab').openFile(file);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function generateTitle(messages: UIChatMessage[]): string {
	const first = messages.find(m => m.role === 'user');
	if (!first) return t('chat.newChat');
	return first.content.slice(0, 40) + (first.content.length > 40 ? '…' : '');
}

export async function generateTitleWithLLM(
	messages: UIChatMessage[],
	providerConfig: LLMProviderConfig,
	modelId: string,
	_settings: import('../../core/settings/settings.types').LuminaSettings
): Promise<string> {
	const first = messages.find(m => m.role === 'user');
	if (!first || !first.content.trim()) return t('chat.newChat');

	// Prompt Injection 방지: 입력을 200자로 제한하고 큰따옴표 이스케이프
	const safeContent = first.content
		.slice(0, 200)
		.replace(/"/g, '\\"');
	const prompt = `Summarize the following user message into a very short title in 3-5 words. Output only the title text, no quotes, no explanations.\n\nUser message: "${safeContent}"`;

	try {
		const { createProvider } = await import('../../core/llm-providers/index');
		const provider = createProvider(providerConfig);
		const response = await provider.chat(
			[
				{ role: 'system', content: 'You are a title generator. Reply with ONLY the title in 3-5 words, in the same language as the user\'s message. No explanations, no thinking tags, no markdown. Just the title text.' },
				{ role: 'user', content: prompt }
			],
			{
				model: modelId,
				temperature: 0,
				maxOutputTokens: 2000
			}
		);
		// reasoning 모델 대응: </think> 이후 텍스트만 추출
		let rawContent = response.content;
		const thinkEndIdx = rawContent.lastIndexOf('</think>');
		if (thinkEndIdx !== -1) {
			rawContent = rawContent.substring(thinkEndIdx + 8).trim();
		}
		const title = sanitizeDisplayContent(rawContent).replace(/["']/g, '').trim();
		return title || generateTitle(messages);
	} catch (e) {
		console.warn('Lumina: Failed to generate title with LLM, falling back to text extraction.', e);
		return generateTitle(messages);
	}
}

