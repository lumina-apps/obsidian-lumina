import { TFile, TFolder, normalizePath } from 'obsidian';
import { t } from '../../../../shared/locales/helpers';
import { sanitizeFilePath } from '../../../../shared/utils/fileUtils';
import { applyReadLimit, getStringArg, getStringOptArg, getNumberArg, blockIfPathNotAllowed, getDailyNotePath } from '../handlerHelpers';
import type { ToolArguments, ToolHandlerContext, ToolResult } from '../toolTypes';
import type { PathGuard } from '../pathGuard';

const DOCUMENT_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'epub']);
const TEXT_EXTENSIONS = new Set([
	'md', 'markdown', 'txt', 'canvas', 'json', 'yaml', 'yml',
	'css', 'js', 'ts', 'jsx', 'tsx', 'html', 'xml', 'csv', 'svg'
]);

async function readFileSafely(file: TFile, ctx: ToolHandlerContext): Promise<string> {
	const ext = file.extension?.toLowerCase() || '';

	if (DOCUMENT_EXTENSIONS.has(ext)) {
		if (ctx.plugin.embeddingWorker) {
			try {
				const buffer = await ctx.plugin.app.vault.readBinary(file);
				const parsed = await ctx.plugin.embeddingWorker.parse(buffer, ext);
				if (parsed && parsed.trim().length > 0) {
					return parsed;
				}
			} catch (e) {
				return `[Document file: ${file.path} (${ext.toUpperCase()}), failed to parse content: ${e}]`;
			}
		}
		return `[Document file: ${file.path} (${ext.toUpperCase()}), size: ${file.stat.size} bytes. Text parser not initialized.]`;
	}

	if (!TEXT_EXTENSIONS.has(ext) && ext !== '') {
		return `[Binary file: ${file.path} (${ext.toUpperCase()}), size: ${file.stat.size} bytes. Binary reading not supported.]`;
	}

	return await ctx.plugin.app.vault.read(file);
}

export const readActiveNoteHandler = async (
	_args: ToolArguments,
	ctx: ToolHandlerContext,
	_pathGuard: PathGuard,
): Promise<ToolResult> => {
	const activeFile = ctx.plugin.app.workspace.getActiveFile();
	if (!activeFile) {
		return { content: [{ type: 'text', text: t('mcpServerTools.read_active_note.noActive') }] };
	}
	// 활성 노트는 항상 읽기 허용 (사용자가 직접 열어둔 파일)
	const content = await readFileSafely(activeFile, ctx);
	return { content: [{ type: 'text', text: `[${activeFile.path}]\n${applyReadLimit(content, ctx.limitRead)}` }] };
};

export const readNoteHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const rawPath = getStringArg(args, 'path');
	if (!rawPath.trim()) {
		return { isError: true, content: [{ type: 'text', text: 'Path is required.' }] };
	}

	let path = sanitizeFilePath(rawPath, false, ctx.plugin.app);
	let file = ctx.plugin.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile) && !path.toLowerCase().endsWith('.md')) {
		const mdPath = `${path}.md`;
		const mdFile = ctx.plugin.app.vault.getAbstractFileByPath(mdPath);
		if (mdFile instanceof TFile) {
			path = mdPath;
			file = mdFile;
		}
	}

	const blocked = blockIfPathNotAllowed(path, ctx, pathGuard);
	if (blocked) return blocked;

	if (!(file instanceof TFile)) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.read_note.notFound', { path }) }] };
	}

	const parsedStart = getNumberArg(args, 'startLine');
	const parsedEnd = getNumberArg(args, 'endLine');
	const startLine = typeof parsedStart === 'number' && parsedStart > 0 ? Math.floor(parsedStart) : undefined;
	const endLine = typeof parsedEnd === 'number' && parsedEnd > 0 ? Math.floor(parsedEnd) : undefined;

	if (startLine !== undefined && endLine !== undefined && startLine > endLine) {
		return { isError: true, content: [{ type: 'text', text: `startLine (${startLine}) cannot be greater than endLine (${endLine}).` }] };
	}

	const content = await readFileSafely(file, ctx);

	if (startLine !== undefined || endLine !== undefined) {
		const lines = content.split('\n');
		const totalLines = lines.length;
		const start = startLine !== undefined ? Math.min(startLine, totalLines) : 1;
		const end = endLine !== undefined ? Math.min(endLine, totalLines) : totalLines;

		if (startLine !== undefined && startLine > totalLines) {
			return { content: [{ type: 'text', text: `[${path} (Lines ${startLine}-${endLine ?? totalLines} of ${totalLines})]: (empty, startLine exceeds total lines)` }] };
		}

		const sliced = lines.slice(start - 1, Math.max(start, end)).join('\n');
		const header = `[${path} (Lines ${start}-${end} of ${totalLines})]:\n`;
		return { content: [{ type: 'text', text: header + applyReadLimit(sliced, ctx.limitRead) }] };
	}

	return { content: [{ type: 'text', text: applyReadLimit(content, ctx.limitRead) }] };
};

export const readDailyNoteHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const date = getStringOptArg(args, 'date');
	const path = await getDailyNotePath(ctx.plugin.app, date);
	const blocked = blockIfPathNotAllowed(path, ctx, pathGuard);
	if (blocked) return blocked;

	const file = ctx.plugin.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile)) {
		return { isError: true, content: [{ type: 'text', text: t('mcpServerTools.read_daily_note.notFound', { path }) }] };
	}
	const content = await ctx.plugin.app.vault.read(file);
	return { content: [{ type: 'text', text: applyReadLimit(content, ctx.limitRead) }] };
};

export const getBacklinksHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const rawPath = getStringArg(args, 'path');
	if (!rawPath.trim()) {
		return { isError: true, content: [{ type: 'text', text: 'path is required.' }] };
	}
	let path = sanitizeFilePath(rawPath, false, ctx.plugin.app);
	let file = ctx.plugin.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile) && !path.toLowerCase().endsWith('.md')) {
		const mdPath = `${path}.md`;
		const mdFile = ctx.plugin.app.vault.getAbstractFileByPath(mdPath);
		if (mdFile instanceof TFile) {
			path = mdPath;
			file = mdFile;
		}
	}

	const blocked = blockIfPathNotAllowed(path, ctx, pathGuard);
	if (blocked) return blocked;

	const resolvedLinks = ctx.plugin.app.metadataCache.resolvedLinks;
	const backlinks: string[] = [];

	for (const sourcePath in resolvedLinks) {
		if (resolvedLinks[sourcePath][path] !== undefined) {
			if (pathGuard.isAgentPathAllowed(sourcePath, ctx.plugin)) {
				backlinks.push(sourcePath);
			}
		}
	}

	if (backlinks.length === 0) {
		return { content: [{ type: 'text', text: `No backlinks found for ${path}` }] };
	}
	const result = `Backlinks for ${path}:\n${backlinks.join('\n')}`;
	return { content: [{ type: 'text', text: applyReadLimit(result, ctx.limitRead) }] };
};

export const getNoteMetadataHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const rawPath = getStringArg(args, 'path');
	if (!rawPath.trim()) {
		return { isError: true, content: [{ type: 'text', text: 'path is required.' }] };
	}
	let path = sanitizeFilePath(rawPath, false, ctx.plugin.app);
	let file = ctx.plugin.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile) && !path.toLowerCase().endsWith('.md')) {
		const mdPath = `${path}.md`;
		const mdFile = ctx.plugin.app.vault.getAbstractFileByPath(mdPath);
		if (mdFile instanceof TFile) {
			path = mdPath;
			file = mdFile;
		}
	}

	const blocked = blockIfPathNotAllowed(path, ctx, pathGuard);
	if (blocked) return blocked;

	if (!(file instanceof TFile)) {
		return { isError: true, content: [{ type: 'text', text: `File not found: ${path}` }] };
	}

	const cache = ctx.plugin.app.metadataCache.getFileCache(file);
	const frontmatter = cache?.frontmatter;
	const bodyTags = cache?.tags?.map(t => t.tag) || [];
	const fmTags: unknown = frontmatter?.tags ?? frontmatter?.tag;
	const normalizedFm: string[] = fmTags
		? (Array.isArray(fmTags) ? (fmTags as unknown[]) : [fmTags]).map(t => String(t).startsWith('#') ? String(t) : '#' + String(t))
		: [];
	const tags = Array.from(new Set([...bodyTags, ...normalizedFm]));
	const aliases = (frontmatter?.aliases ?? frontmatter?.alias ?? []) as unknown;

	const headings = cache?.headings?.map(h => ({
		heading: h.heading,
		level: h.level,
		line: (h.position?.start?.line ?? 0) + 1,
	})) || [];
	const links = cache?.links?.map(l => ({
		link: l.link,
		displayText: l.displayText || undefined,
	})) || [];
	const embeds = cache?.embeds?.map(e => ({
		link: e.link,
		displayText: e.displayText || undefined,
	})) || [];

	const metadata = {
		path: file.path,
		basename: file.basename,
		extension: file.extension,
		size: file.stat.size,
		ctime: file.stat.ctime,
		mtime: file.stat.mtime,
		tags,
		aliases,
		frontmatter,
		headings,
		links,
		embeds,
	};

	const json = JSON.stringify(metadata, null, 2);
	return { content: [{ type: 'text', text: applyReadLimit(json, ctx.limitRead) }] };
};

export const listAttachmentsHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const rawPathArg = getStringOptArg(args, 'path');
	const rawPath = rawPathArg ? sanitizeFilePath(rawPathArg, false, ctx.plugin.app) : undefined;
	const allFiles = ctx.plugin.app.vault.getFiles();
	
	const isAttachment = (f: TFile) => !f.path.endsWith('.md') && !f.path.endsWith('.canvas');

	if (rawPath) {
		let targetPath = rawPath;
		let file = ctx.plugin.app.vault.getAbstractFileByPath(targetPath);
		if (!(file instanceof TFile) && !targetPath.toLowerCase().endsWith('.md')) {
			const mdPath = `${targetPath}.md`;
			const mdFile = ctx.plugin.app.vault.getAbstractFileByPath(mdPath);
			if (mdFile instanceof TFile) {
				targetPath = mdPath;
				file = mdFile;
			}
		}

		const blocked = blockIfPathNotAllowed(targetPath, ctx, pathGuard);
		if (blocked) return blocked;

		if (!(file instanceof TFile)) {
			return { isError: true, content: [{ type: 'text', text: `File not found: ${targetPath}` }] };
		}
		
		const resolvedLinks = ctx.plugin.app.metadataCache.resolvedLinks[targetPath] || {};
		const attachments = Object.keys(resolvedLinks).filter(p => {
			if (!pathGuard.isAgentPathAllowed(p, ctx.plugin)) return false;
			const targetFile = ctx.plugin.app.vault.getAbstractFileByPath(p);
			return targetFile instanceof TFile && isAttachment(targetFile);
		});

		if (attachments.length === 0) {
			return { content: [{ type: 'text', text: `No attachments linked in ${targetPath}` }] };
		}
		const result = `Attachments linked in ${targetPath}:\n${attachments.join('\n')}`;
		return { content: [{ type: 'text', text: applyReadLimit(result, ctx.limitRead) }] };
	} else {
		// List all attachments in vault respecting pathGuard
		const attachments = allFiles
			.filter(f => isAttachment(f) && pathGuard.isAgentPathAllowed(f.path, ctx.plugin))
			.map(f => f.path);
		if (attachments.length === 0) {
			return { content: [{ type: 'text', text: 'No attachments found in the vault.' }] };
		}
		// limit output to prevent massive payload
		const result = attachments.join('\n');
		return { content: [{ type: 'text', text: `All attachments:\n${applyReadLimit(result, ctx.limitRead)}` }] };
	}
};

export const listFoldersHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const rawParent = getStringOptArg(args, 'folderPath');
	const recursive = Boolean(args.recursive);
	const parent = rawParent ? normalizePath(sanitizeFilePath(rawParent, false, ctx.plugin.app)) : '';

	if (parent) {
		const blocked = blockIfPathNotAllowed(parent, ctx, pathGuard);
		if (blocked) return blocked;
	}

	const allFiles = ctx.plugin.app.vault.getAllLoadedFiles();
	const folders = allFiles.filter((f): f is TFolder => {
		if (!(f instanceof TFolder)) return false;
		if (f.path === '/' || f.path === '') return false;
		return pathGuard.isAgentPathAllowed(f.path, ctx.plugin);
	});

	let matched: string[] = [];
	if (!parent) {
		if (recursive) {
			matched = folders.map(f => f.path);
		} else {
			matched = folders.filter(f => !f.path.includes('/')).map(f => f.path);
		}
	} else {
		const parentPrefix = `${parent}/`;
		if (recursive) {
			matched = folders
				.filter(f => f.path.startsWith(parentPrefix))
				.map(f => f.path);
		} else {
			matched = folders
				.filter(f => f.path.startsWith(parentPrefix) && !f.path.slice(parentPrefix.length).includes('/'))
				.map(f => f.path);
		}
	}

	matched.sort((a, b) => a.localeCompare(b));

	if (matched.length === 0) {
		return { content: [{ type: 'text', text: parent ? `No subfolders found in ${parent}` : 'No folders found in vault root.' }] };
	}

	const header = parent ? `Folders in ${parent} (${matched.length}):\n` : `Folders in vault root (${matched.length}):\n`;
	return { content: [{ type: 'text', text: header + applyReadLimit(matched.join('\n'), ctx.limitRead) }] };
};

export const getOutgoingLinksHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const rawPath = getStringArg(args, 'path');
	if (!rawPath.trim()) {
		return { isError: true, content: [{ type: 'text', text: 'path is required.' }] };
	}
	let path = sanitizeFilePath(rawPath, false, ctx.plugin.app);
	let file = ctx.plugin.app.vault.getAbstractFileByPath(path);
	if (!(file instanceof TFile) && !path.toLowerCase().endsWith('.md')) {
		const mdPath = `${path}.md`;
		const mdFile = ctx.plugin.app.vault.getAbstractFileByPath(mdPath);
		if (mdFile instanceof TFile) {
			path = mdPath;
			file = mdFile;
		}
	}

	const blocked = blockIfPathNotAllowed(path, ctx, pathGuard);
	if (blocked) return blocked;

	if (!(file instanceof TFile)) {
		return { isError: true, content: [{ type: 'text', text: `File not found: ${path}` }] };
	}

	const cache = ctx.plugin.app.metadataCache.getFileCache(file);
	const resolvedLinks = ctx.plugin.app.metadataCache.resolvedLinks[path] || {};

	interface OutgoingEntry {
		target: string;
		displayText?: string;
		isResolved: boolean;
		type: 'link' | 'embed';
	}
	const outgoing: OutgoingEntry[] = [];

	if (cache?.links) {
		for (const l of cache.links) {
			const isResolved = Boolean(resolvedLinks[l.link] !== undefined || ctx.plugin.app.metadataCache.getFirstLinkpathDest(l.link, path));
			outgoing.push({
				target: l.link,
				displayText: l.displayText || undefined,
				isResolved,
				type: 'link',
			});
		}
	}

	if (cache?.embeds) {
		for (const e of cache.embeds) {
			const isResolved = Boolean(resolvedLinks[e.link] !== undefined || ctx.plugin.app.metadataCache.getFirstLinkpathDest(e.link, path));
			outgoing.push({
				target: e.link,
				displayText: e.displayText || undefined,
				isResolved,
				type: 'embed',
			});
		}
	}

	if (outgoing.length === 0) {
		return { content: [{ type: 'text', text: `No outgoing links or embeds found in ${path}.` }] };
	}

	const formatted = outgoing.map(o => {
		const status = o.isResolved ? 'resolved' : 'unresolved';
		const alias = o.displayText ? ` (display: "${o.displayText}")` : '';
		return `- [${o.type.toUpperCase()}] ${o.target}${alias} [${status}]`;
	}).join('\n');

	const header = `Outgoing links from ${path} (${outgoing.length}):\n`;
	return { content: [{ type: 'text', text: header + applyReadLimit(formatted, ctx.limitRead) }] };
};