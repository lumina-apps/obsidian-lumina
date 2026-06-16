import { TFile, normalizePath } from 'obsidian';
import { t } from '../../../shared/locales/helpers';
import { sanitizeFilePath } from '../../../shared/utils/fileUtils';
import { searchVault, formatRagContext } from '../../../features/rag/search';
import type { ToolArguments, ToolHandlerContext, ToolResult, ToolName } from './types';
import type { PathGuard } from './pathGuard';

/**
 * 실제 툴 핸들러 시그니처.
 * pathGuard가 필요 없는 핸들러도 세 번째 인자를 받지만 사용하지 않을 수 있습니다.
 */
export type ToolHandlerImpl = (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
) => Promise<ToolResult>;

// ─── 유틸 ─────────────────────────────────────────────────────────────────────

/** 읽기 결과가 limitRead를 초과하면 자릅니다. */
function applyReadLimit(content: string, limit: number): string {
	if (content.length > limit) {
		return content.substring(0, limit) + t('mcpServerTools.common.truncated', { limit });
	}
	return content;
}

/** args에서 string 값을 안전하게 추출합니다 (런타임 타입 가드). */
function getStringArg(args: ToolArguments, key: string): string {
	const val = args[key];
	return typeof val === 'string' ? val : '';
}

/** args에서 number 값을 안전하게 추출합니다 (런타임 타입 가드). */
function getNumberArg(args: ToolArguments, key: string): number | undefined {
	const val = args[key];
	return typeof val === 'number' ? val : undefined;
}

/** args에서 string | undefined 값을 안전하게 추출합니다. */
function getStringOptArg(args: ToolArguments, key: string): string | undefined {
	const val = args[key];
	if (val === undefined || val === null) return undefined;
	return typeof val === 'string' ? val : undefined;
}

/** 오늘 날짜(yyyy-MM-dd)를 반환합니다. */
function getTodayString(): string {
	return new Date().toISOString().split('T')[0];
}

// ─── 헬퍼 ────────────────────────────────────────────────────────────────────

/** 경로 접근 가능 여부를 확인하고 거부 시 오류 결과를 반환합니다. */
function blockIfPathNotAllowed(
	path: string,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): ToolResult | null {
	if (!pathGuard.isAgentPathAllowed(path, ctx.plugin)) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.common.pathExcluded', { path }) }] };
	}
	return null;
}

// ─── 툴 핸들러 ───────────────────────────────────────────────────────────────

const readActiveNoteHandler: ToolHandlerImpl = async (_args, ctx, _pathGuard) => {
	const activeFile = ctx.plugin.app.workspace.getActiveFile();
	if (!activeFile) {
		return { content: [{ type: 'text', text: t('mcpServerTools.read_active_note.noActive') }] };
	}
	// 활성 노트는 항상 읽기 허용 (사용자가 직접 열어둔 파일)
	const content = await ctx.plugin.app.vault.read(activeFile);
	return { content: [{ type: 'text', text: `[${activeFile.path}]\n${applyReadLimit(content, ctx.limitRead)}` }] };
};

const readNoteHandler: ToolHandlerImpl = async (args, ctx, pathGuard) => {
	const path = sanitizeFilePath(getStringArg(args, 'path'));
	const blocked = blockIfPathNotAllowed(path, ctx, pathGuard);
	if (blocked) return blocked;

	const file = ctx.plugin.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.read_note.notFound', { path }) }] };
	}
	const content = await ctx.plugin.app.vault.read(file);
	return { content: [{ type: 'text', text: applyReadLimit(content, ctx.limitRead) }] };
};

const createNoteHandler: ToolHandlerImpl = async (args, ctx, pathGuard) => {
	let rawPath = getStringArg(args, 'path');
	const rawContent = getStringArg(args, 'content');

	if (rawContent.length > ctx.limitAppend) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.create_note.tooLong', { limit: ctx.limitAppend }) }] };
	}

	// 파일명 특수문자 정제 및 .md 확장 보장
	rawPath = sanitizeFilePath(rawPath);

	const blocked = blockIfPathNotAllowed(rawPath, ctx, pathGuard);
	if (blocked) return blocked;

	const existingFile = ctx.plugin.app.vault.getAbstractFileByPath(rawPath);
	if (existingFile) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.create_note.alreadyExists', { path: rawPath }) }] };
	}

	// 부모 폴더가 없으면 에러
	const parentPath = rawPath.substring(0, rawPath.lastIndexOf('/'));
	if (parentPath && !ctx.plugin.app.vault.getAbstractFileByPath(parentPath)) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.create_note.parentFolderNotFound', { parentPath }) }] };
	}

	await pathGuard.lock(rawPath, async () => {
		await ctx.plugin.app.vault.create(rawPath, rawContent);
	});
	return { content: [{ type: 'text', text: t('mcpServerTools.create_note.success', { path: rawPath }) }] };
};

const searchNotesHandler: ToolHandlerImpl = async (args, ctx, pathGuard) => {
	const query = getStringArg(args, 'query').toLowerCase();
	const files = ctx.plugin.app.vault.getMarkdownFiles();
	const results: string[] = [];

	for (const file of files) {
		// 제외된 경로는 검색 대상에서 제외
		if (!pathGuard.isAgentPathAllowed(file.path, ctx.plugin)) {
			continue;
		}
		const content = await ctx.plugin.app.vault.read(file);
		const lowerContent = content.toLowerCase();
		const index = lowerContent.indexOf(query);
		if (index !== -1) {
			const start = Math.max(0, index - ctx.snippetLen);
			const end = Math.min(content.length, index + query.length + ctx.snippetLen);
			let snippet = content.substring(start, end).replace(/\n/g, ' ');
			if (start > 0) snippet = '...' + snippet;
			if (end < content.length) snippet = snippet + '...';

			results.push(`[${file.path}]\n${snippet}\n`);
			if (results.length >= ctx.maxResults) break;
		}
	}
	return {
		content: [
			{
				type: 'text',
				text: results.length > 0
					? t('mcpServerTools.search_notes.foundPrefix', { max: ctx.maxResults }) + results.join('\n')
					: t('mcpServerTools.search_notes.noResults'),
			},
		],
	};
};

const appendToNoteHandler: ToolHandlerImpl = async (args, ctx, pathGuard) => {
	const path = sanitizeFilePath(getStringArg(args, 'path'));
	const newContent = getStringArg(args, 'content');

	if (newContent.length > ctx.limitAppend) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.append_to_note.tooLong', { limit: ctx.limitAppend }) }] };
	}

	const blocked = blockIfPathNotAllowed(path, ctx, pathGuard);
	if (blocked) return blocked;

	const file = ctx.plugin.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.append_to_note.notFound', { path }) }] };
	}

	return await pathGuard.lock(path, async () => {
		const currentContent = await ctx.plugin.app.vault.read(file);
		if (currentContent.length + newContent.length > 100000) {
			return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.append_to_note.maxLengthExceeded') }] };
		}

		await ctx.plugin.app.vault.modify(file, currentContent + '\n' + newContent);
		return { content: [{ type: 'text', text: t('mcpServerTools.append_to_note.success', { path }) }] };
	});
};

const readDailyNoteHandler: ToolHandlerImpl = async (_args, ctx, _pathGuard) => {
	const path = `${getTodayString()}.md`;
	// 데일리 노트 읽기는 항상 허용
	const file = ctx.plugin.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.read_daily_note.notFound', { path }) }] };
	}
	const content = await ctx.plugin.app.vault.read(file);
	return { content: [{ type: 'text', text: applyReadLimit(content, ctx.limitRead) }] };
};

const appendToDailyNoteHandler: ToolHandlerImpl = async (args, ctx, pathGuard) => {
	const path = `${getTodayString()}.md`;
	const newContent = getStringArg(args, 'content');

	if (newContent.length > ctx.limitAppend) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.append_to_daily_note.tooLong', { limit: ctx.limitAppend }) }] };
	}

	// 데일리 노트 추가는 항상 허용
	return await pathGuard.lock(path, async () => {
		const file = ctx.plugin.app.vault.getAbstractFileByPath(path);
		if (file instanceof TFile) {
			const currentContent = await ctx.plugin.app.vault.read(file);
			if (currentContent.length + newContent.length > 100000) {
				return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.append_to_daily_note.maxLengthExceeded') }] };
			}
			await ctx.plugin.app.vault.modify(file, currentContent + '\n' + newContent);
			return { content: [{ type: 'text', text: t('mcpServerTools.append_to_daily_note.successAppend', { path }) }] };
		} else {
			await ctx.plugin.app.vault.create(path, newContent);
			return { content: [{ type: 'text', text: t('mcpServerTools.append_to_daily_note.successCreate', { path }) }] };
		}
	});
};

const listNotesHandler: ToolHandlerImpl = async (args, ctx, pathGuard) => {
	const folderPath = getStringOptArg(args, 'path');
	const allFiles: TFile[] = ctx.plugin.app.vault.getMarkdownFiles();

	let filteredFiles: TFile[] = allFiles;
	let displayPath = '';

	if (folderPath) {
		const normalized = normalizePath(folderPath);
		displayPath = ` in ${normalized}`;
		filteredFiles = allFiles.filter((f: TFile) => {
			const filePath = f.path;
			return filePath === normalized || filePath.startsWith(normalized + '/');
		});
	}

	// 제외된 경로 필터링
	filteredFiles = filteredFiles.filter((f: TFile) => pathGuard.isAgentPathAllowed(f.path, ctx.plugin));

	if (filteredFiles.length === 0) {
		return { content: [{ type: 'text', text: t('mcpServerTools.list_notes.noNotes', { path: displayPath }) }] };
	}

	const fileList = filteredFiles.map((f: TFile) => f.path).sort().join('\n');
	const result = t('mcpServerTools.list_notes.listPrefix', { path: displayPath, count: filteredFiles.length }) + fileList;
	return { content: [{ type: 'text', text: applyReadLimit(result, ctx.limitRead) }] };
};

const ragSearchHandler: ToolHandlerImpl = async (args, ctx, _pathGuard) => {
	const indexer = ctx.plugin.indexer;
	if (!indexer || indexer.indexedChunks.length === 0) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.rag_search.notReady') }] };
	}

	const rawQuery = getStringArg(args, 'query');
	if (!rawQuery.trim()) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.rag_search.emptyQuery') }] };
	}

	const rawTopK = getNumberArg(args, 'top_k');
	const rawMinSim = getNumberArg(args, 'min_similarity');

	const topK = typeof rawTopK === 'number' ? Math.min(rawTopK, ctx.maxResults) : Math.min(5, ctx.maxResults);
	const minSim = typeof rawMinSim === 'number' ? Math.max(0, Math.min(1, rawMinSim)) : 0.65;

	try {
		const results = await searchVault(
			rawQuery,
			indexer.indexedChunks,
			(texts: string[]) => indexer.embed(texts),
			topK,
			minSim,
		);

		if (results.length === 0) {
			return { content: [{ type: 'text', text: t('mcpServerTools.rag_search.noResults') }] };
		}

		const context = formatRagContext(results);
		const summary = t('mcpServerTools.rag_search.summary', { count: results.length, minSim, context });
		return { content: [{ type: 'text', text: applyReadLimit(summary, ctx.limitRead) }] };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.rag_search.error', { error: message }) }] };
	}
};

// ─── 핸들러 맵 ────────────────────────────────────────────────────────────────

const handlerMap: Record<ToolName, ToolHandlerImpl> = {
	read_active_note: readActiveNoteHandler,
	read_note: readNoteHandler,
	create_note: createNoteHandler,
	search_notes: searchNotesHandler,
	append_to_note: appendToNoteHandler,
	read_daily_note: readDailyNoteHandler,
	append_to_daily_note: appendToDailyNoteHandler,
	list_notes: listNotesHandler,
	rag_search: ragSearchHandler,
};

/**
 * 툴 이름과 인자를 받아 적절한 핸들러로 분배합니다.
 * pathGuard를 생성자에서 주입받아 접근 제어가 필요한 핸들러에 전달합니다.
 */
export function dispatchToolHandler(
	name: string,
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> {
	const handler = handlerMap[name as ToolName];
	if (handler) {
		return handler(args, ctx, pathGuard);
	}
	return Promise.resolve({ isError: true, content: [{ type: 'text', text: t('mcpServerTools.common.unknownTool') }] });
}