import { normalizePath, type App, TFolder, TFile } from 'obsidian';
import { t } from '../../shared/locales/helpers';
import type { ChatSession } from '../../shared/types/chat.types';
import { debugLogger } from '../../shared/debugLogger';
import { sanitizeDisplayContent } from '../../shared/utils/llmTextSanitizer';

// ─── 하위 호환성을 위한 Re-exports ──────────────────────────────────────────────
export * from './utils/historySerializer';
export * from './utils/titleGenerator';

import {
	serializeSession,
	extractFrontmatter,
	parseFrontmatterFromContent,
	parseTimestamp,
	parseTimestampFromFilename,
	base64ToUtf8,
	type HistoryFrontmatter,
} from './utils/historySerializer';
import { sanitizeSafeTitle } from './utils/titleGenerator';

// ─── 파일 경로 및 탐색 유틸 ───────────────────────────────────────────────────

/**
 * 대상 폴더 내에서 파일명이 중복되지 않도록 (1), (2) 접미사를 붙여 고유 경로 반환.
 * 대상 파일이 이미 존재하더라도 existingFile과 동일한 파일인 경우는 그대로 반환.
 */
export async function getAvailableHistoryPath(
	app: App,
	folderPath: string,
	baseFilename: string,
	existingFile: TFile | null,
): Promise<string> {
	let candidateName = baseFilename;
	let counter = 1;
	const dotIdx = baseFilename.lastIndexOf('.');
	const nameWithoutExt = dotIdx !== -1 ? baseFilename.slice(0, dotIdx) : baseFilename;
	const ext = dotIdx !== -1 ? baseFilename.slice(dotIdx) : '';

	for (let i = 0; i < 100; i++) {
		const candidatePath = normalizePath(`${folderPath}/${candidateName}`);
		const abstractFile = app.vault.getAbstractFileByPath(candidatePath);
		if (!abstractFile || (existingFile && abstractFile.path === existingFile.path)) {
			return candidatePath;
		}
		if (!(abstractFile instanceof TFile)) {
			return candidatePath;
		}
		candidateName = `${nameWithoutExt} (${counter})${ext}`;
		counter++;
	}
	return normalizePath(`${folderPath}/${baseFilename}`);
}

/** 특정 디렉토리 내 .md 파일만 가져온다 (vault 전체 스캔 방지) */
function getHistoryFiles(app: App, basePath: string): TFile[] {
	const cleanBase = (basePath?.trim() || 'chatHistory').replace(/[/\\]+$/, '');
	const normalBase = normalizePath(cleanBase);
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
			const fm = extractFrontmatter(text);
			if (fm?.id === sessionId) {
				return f;
			}
		} catch { /* ignore */ }
	}

	return null;
}

// ─── Save ─────────────────────────────────────────────────────────────────────

export async function saveSession(app: App, session: ChatSession, basePath: string): Promise<void> {
	debugLogger.logSystem('history', `saveSession started (sessionId=${session.id}, title="${session.title}", basePath=${basePath})`);
	const cleanBase = (basePath?.trim() || 'chatHistory').replace(/[/\\]+$/, '');
	const normalBase = normalizePath(cleanBase);

	// 파일명: YYMMDD_HHMM - [title]
	const dateObj = new Date(session.createdAt);
	const yy = String(dateObj.getFullYear()).slice(2);
	const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
	const dd = String(dateObj.getDate()).padStart(2, '0');
	const hh = String(dateObj.getHours()).padStart(2, '0');
	const min = String(dateObj.getMinutes()).padStart(2, '0');
	const safeTitle = sanitizeSafeTitle(session.title);
	const filename = `${yy}${mm}${dd}_${hh}${min} - ${safeTitle}.md`;

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
				const fm = extractFrontmatter(text);
				if (fm?.id === session.id) {
					existingFile = f;
					break;
				}
			} catch { /* ignore */ }
		}
	}

	const targetFilePath = await getAvailableHistoryPath(app, normalBase, filename, existingFile ?? null);

	if (existingFile) {
		if (existingFile.path !== targetFilePath) {
			await app.vault.rename(existingFile, targetFilePath);
		}
		await app.vault.modify(existingFile, content);
		debugLogger.logSystem('history', `saveSession: updated existing session file (${existingFile.path})`);
	} else {
		await app.vault.create(targetFilePath, content);
		debugLogger.logSystem('history', `saveSession: created new session file (${targetFilePath})`);
	}
}

// ─── Load & Delete ─────────────────────────────────────────────────────────────

export async function loadSessionsList(app: App, basePath: string): Promise<ChatSession[]> {
	debugLogger.logSystem('history', `loadSessionsList started (basePath=${basePath})`);
	const cleanBase = (basePath?.trim() || 'chatHistory').replace(/[/\\]+$/, '');
	const normalBase = normalizePath(cleanBase);
	const folderExists = await app.vault.adapter.exists(normalBase);
	if (!folderExists) {
		debugLogger.logSystem('history', `loadSessionsList: folder does not exist (${normalBase}), returning empty.`);
		return [];
	}

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

			const modelClean = fm.model ? String(fm.model).replace(/^["']|["']$/g, '') : '';
			const providerClean = fm.provider ? String(fm.provider).replace(/^["']|["']$/g, '') : '';

			sessions.push({
				id: String(fm.id),
				title: fm.title || t('chat.newChat'),
				createdAt,
				updatedAt,
				providerId: providerClean,
				modelId: modelClean,
				messages: [], // 목록에서는 메시지 본문을 로드하지 않음 (최적화)
			});
		}
	}

	// 최신순 정렬 (NaN 방어)
	const sorted = sessions.sort((a, b) => {
		const diff = b.updatedAt - a.updatedAt;
		return isNaN(diff) ? 0 : diff;
	});
	debugLogger.logSystem('history', `loadSessionsList completed (sessions=${sorted.length})`);
	return sorted;
}

/** 세션 파일에서 숨김 JSON을 파싱해 ChatSession(메시지 포함) 복원 */
export async function loadSession(app: App, sessionId: string, basePath: string): Promise<ChatSession | null> {
	debugLogger.logSystem('history', `loadSession started (sessionId=${sessionId}, basePath=${basePath})`);
	const cleanBase = (basePath?.trim() || 'chatHistory').replace(/[/\\]+$/, '');
	const normalBase = normalizePath(cleanBase);
	const files = getHistoryFiles(app, normalBase);
	
	const file = await findSessionFile(app, files, sessionId);
	if (!file) {
		debugLogger.logSystem('history', `loadSession: session file not found (sessionId=${sessionId})`);
		return null;
	}

	const content = await app.vault.read(file);
	
	// V2 포맷 우선 시도 (base64 인코딩 - 공백/줄바꿈 관용 처리), V1 폴백 (하위 호환)
	const matchV2 = content.match(/<!-- LUMINA_HISTORY_DATA_V2:\s*([\s\S]*?)\s*-->/);
	if (matchV2?.[1]) {
		try {
			const cleanBase64 = matchV2[1].replace(/\s+/g, '');
			const parsed = JSON.parse(base64ToUtf8(cleanBase64)) as ChatSession;
			return parsed;
		} catch (e) {
			debugLogger.logError('history', e instanceof Error ? e : new Error(`Failed to parse V2 history data: ${e}`));
		}
	}

	const match = content.match(/<!-- LUMINA_HISTORY_DATA:\s*([\s\S]*?)\s*-->/);
	if (match && match[1]) {
		try {
			const parsed = JSON.parse(match[1]) as ChatSession;
			return parsed;
		} catch (e) {
			debugLogger.logError('history', e instanceof Error ? e : new Error(`Failed to parse history JSON data: ${e}`));
		}
	}

	return null;
}

/** 세션 제목 변경 */
export async function renameSession(
	app: App,
	sessionId: string,
	newTitle: string,
	basePath: string,
): Promise<ChatSession | null> {
	const trimmedTitle = newTitle.replace(/[\r\n\t\p{Cc}]+/gu, ' ').trim() || t('chat.newChat');
	const session = await loadSession(app, sessionId, basePath);
	if (!session) return null;
	session.title = trimmedTitle;
	session.updatedAt = Date.now();
	await saveSession(app, session, basePath);
	return session;
}

/** 세션 파일 삭제 */
export async function deleteSession(app: App, sessionId: string, basePath: string): Promise<boolean> {
	const cleanBase = (basePath?.trim() || 'chatHistory').replace(/[/\\]+$/, '');
	const normalBase = normalizePath(cleanBase);
	const files = getHistoryFiles(app, normalBase);
	
	const file = await findSessionFile(app, files, sessionId);
	if (file) {
		debugLogger.logSystem('history', `deleteSession: deleting session file (${file.path})`);
		await app.fileManager.trashFile(file);
		debugLogger.logSystem('history', `deleteSession: deleted (sessionId=${sessionId})`);
		return true;
	}
	debugLogger.logSystem('history', `deleteSession: session file not found (sessionId=${sessionId})`);
	return false;
}

// ─── Export ───────────────────────────────────────────────────────────────────

export async function exportSessionToMarkdown(app: App, session: ChatSession): Promise<void> {
	debugLogger.logSystem('history', `exportSessionToMarkdown started (sessionId=${session.id}, title="${session.title}")`);
	const dateObj = new Date(session.createdAt);
	const yy = String(dateObj.getFullYear()).slice(2);
	const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
	const dd = String(dateObj.getDate()).padStart(2, '0');
	const hh = String(dateObj.getHours()).padStart(2, '0');
	const min = String(dateObj.getMinutes()).padStart(2, '0');
	const safeTitle = sanitizeSafeTitle(session.title);
	const filename = `${yy}${mm}${dd}_${hh}${min} - ${safeTitle}.md`;

	const exportFolder = normalizePath('Lumina Exports');
	if (!(await app.vault.adapter.exists(exportFolder))) {
		await app.vault.createFolder(exportFolder);
	}

	const targetPath = await getAvailableHistoryPath(app, exportFolder, filename, null);

	const body = session.messages
		.filter(m => m.role !== 'system')
		.map(m => {
			const label = m.role === 'user' ? '**👤 You**' : `**✦ Lumina** _(${m.model ?? ''})_`;
			const time = new Date(m.timestamp).toLocaleTimeString();
			let content = m.role === 'assistant' ? sanitizeDisplayContent(m.content) : m.content;

			if (m.attachments && m.attachments.length > 0) {
				const attList = m.attachments.map(a => a.path ? `[[${a.path}|${a.name}]]` : `[[${a.name}]]`).join(', ');
				content += `\n\n📎 **Attachments**: ${attList}`;
			}

			if (m.ragSources && m.ragSources.length > 0) {
				const sourceList = Array.from(new Set(m.ragSources.map(s => `[[${s.filePath}]]`))).join(', ');
				content += `\n\n📚 **Sources**: ${sourceList}`;
			}

			return `${label} · ${time}\n\n${content}\n`;
		})
		.join('\n---\n\n');
	
	const header = `# ${session.title}\n\n- **Date**: ${dateObj.toLocaleString()}\n- **Model**: ${session.modelId || 'Unknown'}\n\n---\n\n`;
	const fullContent = header + body;

	const file = await app.vault.create(targetPath, fullContent);
	await app.workspace.getLeaf('tab').openFile(file);
	debugLogger.logSystem('history', `exportSessionToMarkdown completed (file=${targetPath})`);
}
