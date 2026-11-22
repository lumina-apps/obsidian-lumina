import { normalizePath, type App, TFile } from 'obsidian';
import { t } from '../../../shared/locales/helpers';
import { debugLogger } from '../../../shared/debugLogger';
import { normalizeError } from '../../../shared/utils/errorUtils';
import { sanitizeDisplayContent } from '../../../shared/utils/llmTextSanitizer';
import { resolveDateTemplate } from '../../../shared/utils/datePathTemplate';
import type {
	SplitChatSession,
	SplitLayoutMode,
	SplitSessionSummary,
	SplitSlotResponse,
} from '../../../shared/types/splitChat.types';
import {
	ensureHistoryFolder,
	findSessionFile,
	getAvailableHistoryPath,
	getHistoryFiles,
	utf8ToBase64,
	base64ToUtf8,
	extractFrontmatter,
	parseTimestamp,
	parseTimestampFromFilename,
	sanitizeAttachmentsForStorage,
	sanitizeSafeTitle,
} from '../history';
import type { HistoryLocationOptions } from '../utils/historyLocation';
import { formatSplitComparisonMarkdown } from './splitExportFormatter';

const SPLIT_SUBFOLDER_NAME = 'split';

/** Split 전용 히스토리 루트 경로 계산 (일반 채팅 경로 하위의 split 디렉토리) */
export function normalizeSplitBasePath(basePath: string): string {
	const cleanBase = (basePath?.trim() || 'chatHistory')
		.replace(/\\/g, '/')
		.replace(/\/+$/, '');
	const normalized = normalizePath(cleanBase) || 'chatHistory';
	return normalizePath(`${normalized}/${SPLIT_SUBFOLDER_NAME}`);
}

/** 저장용 Split 세션 정제 (think 태그 본문 제거, 첨부파일 content 제거, 스트리밍 상태 정리) */
function sanitizeSplitSessionForStorage(session: SplitChatSession): SplitChatSession {
	return {
		...session,
		turns: session.turns.map((turn) => {
			const cleanedResponses: Record<string, SplitSlotResponse> = {};
			for (const [sid, resp] of Object.entries(turn.responses)) {
				const isInterrupted = resp.status === 'waiting' || resp.status === 'streaming';
				cleanedResponses[sid] = {
					...resp,
					status: isInterrupted ? 'aborted' : resp.status,
					content: sanitizeDisplayContent(resp.content),
				};
			}
			return {
				...turn,
				ragStep: null,
				userMessage: {
					...turn.userMessage,
					attachments: sanitizeAttachmentsForStorage(turn.userMessage.attachments),
				},
				responses: cleanedResponses,
			};
		}),
	};
}

/** Split 세션을 마크다운 및 숨김 Base64 JSON(V1) 포맷으로 직렬화 */
export function serializeSplitSession(session: SplitChatSession): string {
	const cleanSession = sanitizeSplitSessionForStorage(session);
	const hasWinner = cleanSession.turns.some(
		(turn) => turn.winnerSlotId !== undefined && turn.winnerSlotId !== null,
	);
	const modelList = cleanSession.slots.map((s) => s.modelId);

	const frontmatter = [
		'---',
		`id: ${cleanSession.id}`,
		'sessionType: split',
		`title: ${JSON.stringify(cleanSession.title)}`,
		`mode: ${cleanSession.mode}`,
		`models: ${JSON.stringify(modelList)}`,
		`turns: ${cleanSession.turns.length}`,
		`hasWinner: ${hasWinner}`,
		`created: ${new Date(cleanSession.createdAt).toISOString()}`,
		`updated: ${new Date(cleanSession.updatedAt).toISOString()}`,
		'---',
		'',
	].join('\n');

	const body = formatSplitComparisonMarkdown(cleanSession);
	const jsonStr = JSON.stringify(cleanSession);
	const encoded = utf8ToBase64(jsonStr);
	const rawDataBlock = `\n\n<!-- LUMINA_SPLIT_HISTORY_V1: ${encoded} -->\n`;

	return frontmatter + body + rawDataBlock;
}

/** frontmatter models 필드 안전 파싱 */
function parseFrontmatterModels(raw: unknown): string[] {
	if (Array.isArray(raw)) {
		return raw.map((item) => String(item));
	}
	if (typeof raw === 'string' && raw.trim()) {
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (Array.isArray(parsed)) {
				return parsed.map((item) => String(item));
			}
		} catch {
			// 쉼표 구분 폴백
			return raw
				.replace(/^\[|\]$/g, '')
				.split(',')
				.map((s) => s.trim().replace(/^["']|["']$/g, ''))
				.filter(Boolean);
		}
	}
	return [];
}

/** 파일명 생성 헬퍼 */
function buildSplitFilename(title: string, createdAt: number): string {
	const dateObj = new Date(createdAt);
	const yy = String(dateObj.getFullYear()).slice(2);
	const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
	const dd = String(dateObj.getDate()).padStart(2, '0');
	const hh = String(dateObj.getHours()).padStart(2, '0');
	const min = String(dateObj.getMinutes()).padStart(2, '0');
	const safeTitle = sanitizeSafeTitle(title);
	return `${yy}${mm}${dd}_${hh}${min} - [Arena] ${safeTitle}.md`;
}

/** Split 세션을 볼트에 저장 (기존 파일이 있으면 갱신) */
export async function saveSplitSession(
	app: App,
	session: SplitChatSession,
	basePath: string,
	options?: Partial<HistoryLocationOptions>,
): Promise<void> {
	const splitBase = normalizeSplitBasePath(basePath);
	const folderFormat = options?.folderFormat?.trim() ?? '';
	const excludeFolders = options?.excludeFolders ?? [];

	const dateObj = new Date(session.createdAt);
	const filename = buildSplitFilename(session.title, session.createdAt);
	const subFolder = folderFormat ? resolveDateTemplate(folderFormat, dateObj) : '';
	const targetFolder = subFolder
		? normalizePath(`${splitBase}/${subFolder}`)
		: splitBase;

	const content = serializeSplitSession(session);
	await ensureHistoryFolder(app, targetFolder);

	const targetFiles = getHistoryFiles(app, targetFolder, excludeFolders);
	let existingFile = await findSessionFile(app, targetFiles, session.id);

	if (!existingFile && targetFolder !== splitBase) {
		const allFiles = getHistoryFiles(app, splitBase, excludeFolders);
		existingFile = await findSessionFile(app, allFiles, session.id);
	}

	const targetFilePath = await getAvailableHistoryPath(
		app,
		targetFolder,
		filename,
		existingFile ?? null,
	);

	if (existingFile) {
		if (existingFile.path !== targetFilePath) {
			await app.vault.rename(existingFile, targetFilePath);
		}
		await app.vault.modify(existingFile, content);
		debugLogger.logSystem('split-history', `saveSplitSession: updated (${existingFile.path})`);
	} else {
		await app.vault.create(targetFilePath, content);
		debugLogger.logSystem('split-history', `saveSplitSession: created (${targetFilePath})`);
	}
}

/** Split 전용 히스토리 요약 목록 로드 (폴더가 없으면 생성하지 않고 빈 배열 반환) */
export async function loadSplitSessionsList(
	app: App,
	basePath: string,
	options?: Partial<HistoryLocationOptions>,
): Promise<SplitSessionSummary[]> {
	const splitBase = normalizeSplitBasePath(basePath);
	const folderExists = await app.vault.adapter.exists(splitBase);
	if (!folderExists) {
		return [];
	}

	const files: TFile[] = getHistoryFiles(app, splitBase, options?.excludeFolders ?? []);
	const summaries: SplitSessionSummary[] = [];

	for (const file of files) {
		const cache = app.metadataCache.getFileCache(file);
		let fm: Record<string, unknown> | null = cache?.frontmatter ?? null;

		if (!fm || !fm.id || !fm.sessionType) {
			try {
				const content = await app.vault.cachedRead(file);
				fm = extractFrontmatter(content);
			} catch {
				fm = null;
			}
		}

		if (!fm || !fm.id) continue;
		const sessionType = String(fm.sessionType ?? '').replace(/^["']|["']$/g, '');
		if (sessionType !== 'split') continue;

		const rawTitle = fm.title ? String(fm.title) : '';
		let parsedTitle = t('splitChat.newComparison');
		if (rawTitle) {
			try {
				parsedTitle = typeof fm.title === 'string' && rawTitle.startsWith('"')
					? (JSON.parse(rawTitle) as string)
					: rawTitle.replace(/^["']|["']$/g, '');
			} catch {
				parsedTitle = rawTitle.replace(/^["']|["']$/g, '');
			}
		}

		const createdRaw = fm.created as string | number | undefined;
		const updatedRaw = fm.updated as string | number | undefined;
		const fileCreated = parseTimestamp(createdRaw, file.stat.ctime);
		const fileUpdated = parseTimestamp(updatedRaw, file.stat.mtime);

		const createdAt =
			fileCreated > 0
				? fileCreated
				: (parseTimestampFromFilename(file.name.replace(' - [Arena] ', ' - ')) ?? file.stat.ctime);
		const updatedAt =
			fileUpdated > 0
				? fileUpdated
				: (parseTimestampFromFilename(file.name.replace(' - [Arena] ', ' - ')) ?? file.stat.mtime);

		const modeRaw = String(fm.mode ?? 'side-by-side').replace(/^["']|["']$/g, '');
		const mode: SplitLayoutMode = modeRaw === 'blind' ? 'blind' : 'side-by-side';
		const turnCount = Number(fm.turns ?? 0) || 0;
		const hasWinner = fm.hasWinner === true || String(fm.hasWinner) === 'true';
		const modelLabels = parseFrontmatterModels(fm.models);

		summaries.push({
			id: String(fm.id),
			title: parsedTitle || t('splitChat.newComparison'),
			createdAt,
			updatedAt,
			mode,
			turnCount,
			modelLabels,
			hasWinner,
		});
	}

	return summaries.sort((a, b) => {
		const diff = b.updatedAt - a.updatedAt;
		return isNaN(diff) ? 0 : diff;
	});
}

/** 세션 ID로 Split 세션 전체 데이터를 복원 */
export async function loadSplitSession(
	app: App,
	sessionId: string,
	basePath: string,
	options?: Partial<HistoryLocationOptions>,
): Promise<SplitChatSession | null> {
	const splitBase = normalizeSplitBasePath(basePath);
	const files = getHistoryFiles(app, splitBase, options?.excludeFolders ?? []);
	const file = await findSessionFile(app, files, sessionId);
	if (!file) {
		return null;
	}

	const content = await app.vault.read(file);
	const match = content.match(/<!-- LUMINA_SPLIT_HISTORY_V1:\s*([\s\S]*?)\s*-->/);
	if (!match?.[1]) {
		return null;
	}

	try {
		const cleanBase64 = match[1].replace(/\s+/g, '');
		const parsed = JSON.parse(base64ToUtf8(cleanBase64)) as SplitChatSession;
		if (parsed.sessionType !== 'split') return null;
		return parsed;
	} catch (e) {
		debugLogger.logError('split-history', normalizeError(e, `Failed to parse split history: ${e}`));
		return null;
	}
}

/** Split 세션 제목 변경 */
export async function renameSplitSession(
	app: App,
	sessionId: string,
	newTitle: string,
	basePath: string,
	options?: Partial<HistoryLocationOptions>,
): Promise<SplitChatSession | null> {
	const trimmedTitle = newTitle.replace(/[\r\n\t\p{Cc}]+/gu, ' ').trim() || t('splitChat.newComparison');
	const session = await loadSplitSession(app, sessionId, basePath, options);
	if (!session) return null;
	session.title = trimmedTitle;
	session.updatedAt = Date.now();
	await saveSplitSession(app, session, basePath, options);
	return session;
}

/** Split 세션 파일 삭제 */
export async function deleteSplitSession(
	app: App,
	sessionId: string,
	basePath: string,
	options?: Partial<HistoryLocationOptions>,
): Promise<boolean> {
	const splitBase = normalizeSplitBasePath(basePath);
	const files = getHistoryFiles(app, splitBase, options?.excludeFolders ?? []);
	const file = await findSessionFile(app, files, sessionId);
	if (file) {
		await app.fileManager.trashFile(file);
		return true;
	}
	return false;
}

/** Split 세션을 Lumina Exports 폴더에 마크다운 리포트로 내보내고 새 탭으로 열기 */
export async function exportSplitSessionToMarkdown(
	app: App,
	session: SplitChatSession,
): Promise<TFile> {
	const filename = buildSplitFilename(session.title, session.createdAt);
	const exportFolder = normalizePath('Lumina Exports');
	if (!(await app.vault.adapter.exists(exportFolder))) {
		await app.vault.createFolder(exportFolder);
	}
	const targetPath = await getAvailableHistoryPath(app, exportFolder, filename, null);
	const markdown = formatSplitComparisonMarkdown(session);
	const file = await app.vault.create(targetPath, markdown);
	await app.workspace.getLeaf('tab').openFile(file);
	return file;
}
