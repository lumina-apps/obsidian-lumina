import { TFile, normalizePath, getAllTags, type CachedMetadata } from 'obsidian';
import { applyReadLimit, getNumberArg, getNormalizedFileTags, fileMatchesTags } from '../handlerHelpers';
import type { ToolArguments, ToolHandlerContext, ToolResult } from '../toolTypes';
import type { PathGuard } from '../pathGuard';

interface Filter {
	key: string;
	operator: '==' | '!=' | '>' | '<' | '>=' | '<=' | 'contains' | 'not_contains';
	value: string;
}

interface Sort {
	key: string;
	dir: 'asc' | 'desc';
}

function extractFrontmatterValue(cache: CachedMetadata | null, key: string): unknown {
	const frontmatter = cache?.frontmatter;
	if (key === 'tags' || key === 'tag') {
		const fmTags: unknown = frontmatter?.[key];
		const allTags = cache ? (getAllTags(cache) || []) : [];
		const normalizedAll = allTags.map(t => (t.startsWith('#') ? t.slice(1) : t));

		if (fmTags !== undefined && fmTags !== null) {
			const normalizedFm: string[] = Array.isArray(fmTags)
				? (fmTags as unknown[]).map(String)
				: [String(fmTags)];
			return Array.from(new Set([...normalizedFm, ...normalizedAll]));
		}
		if (normalizedAll.length > 0) {
			return normalizedAll;
		}
		return undefined;
	}

	if (!frontmatter) return undefined;
	return frontmatter[key];
}

function getNoteFieldValue(file: TFile, cache: CachedMetadata | null, key: string): unknown {
	if (key === 'basename') return file.basename;
	if (key === 'path') return file.path;
	if (key === 'ctime') return file.stat.ctime;
	if (key === 'mtime') return file.stat.mtime;
	if (key === 'size') return file.stat.size;
	return extractFrontmatterValue(cache, key);
}

function evaluateFilter(actualValue: unknown, filter: Filter): boolean {
	if (actualValue === undefined || actualValue === null) {
		return filter.operator === '!=' || filter.operator === 'not_contains';
	}

	// Normalize target value
	let targetValue: unknown = filter.value;
	if (targetValue === 'true') targetValue = true;
	else if (targetValue === 'false') targetValue = false;
	else if (typeof targetValue === 'string' && targetValue.trim() !== '' && !isNaN(Number(targetValue))) {
		targetValue = Number(targetValue);
	}

	// Convert actualValue for comparison if necessary
	const actualStr = String(actualValue).toLowerCase();
	const targetStr = String(targetValue).toLowerCase();

	switch (filter.operator) {
		case '==':
			return Array.isArray(actualValue) ? (actualValue as unknown[]).includes(targetValue) : actualValue == targetValue;
		case '!=':
			return Array.isArray(actualValue) ? !(actualValue as unknown[]).includes(targetValue) : actualValue != targetValue;
		case '>':
			return (actualValue as number) > (targetValue as number);
		case '<':
			return (actualValue as number) < (targetValue as number);
		case '>=':
			return (actualValue as number) >= (targetValue as number);
		case '<=':
			return (actualValue as number) <= (targetValue as number);
		case 'contains':
			if (Array.isArray(actualValue)) {
				return (actualValue as unknown[]).some(v => String(v).toLowerCase().includes(targetStr));
			}
			return actualStr.includes(targetStr);
		case 'not_contains':
			if (Array.isArray(actualValue)) {
				return !(actualValue as unknown[]).some(v => String(v).toLowerCase().includes(targetStr));
			}
			return !actualStr.includes(targetStr);
		default:
			return false;
	}
}

export const queryMetadataHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	const folder = typeof args.folder === 'string' ? args.folder : undefined;
	const tags = Array.isArray(args.tags) ? (args.tags as string[]) : [];
	const filters = Array.isArray(args.filters) ? (args.filters as Filter[]) : [];
	const sort = typeof args.sort === 'object' && args.sort !== null ? (args.sort as Sort) : undefined;
	const returnFields = Array.isArray(args.returnFields) ? (args.returnFields as string[]) : [];
	const rawLimit = getNumberArg(args, 'limit');
	const limit = typeof rawLimit === 'number' && rawLimit > 0 ? Math.min(rawLimit, 200) : 50;

	const allFiles = ctx.plugin.app.vault.getMarkdownFiles();
	const results: { file: TFile; fields: Record<string, unknown> }[] = [];

	for (const file of allFiles) {
		// 1. PathGuard check
		if (!pathGuard.isAgentPathAllowed(file.path, ctx.plugin)) continue;

		// 2. Folder check
		if (folder) {
			const normalizedFolder = normalizePath(folder);
			if (file.path !== normalizedFolder && !file.path.startsWith(normalizedFolder + '/')) {
				continue;
			}
		}

		const cache = ctx.plugin.app.metadataCache.getFileCache(file);

		// 3. Tags check
		if (tags.length > 0) {
			const fileTags = getNormalizedFileTags(cache);
			if (!fileMatchesTags(fileTags, tags)) continue;
		}

		// 4. Frontmatter & built-in properties filters check
		let passesFilters = true;
		for (const filter of filters) {
			const actualValue = getNoteFieldValue(file, cache, filter.key);
			if (!evaluateFilter(actualValue, filter)) {
				passesFilters = false;
				break;
			}
		}

		if (!passesFilters) continue;

		// 5. Collect return fields
		const fields: Record<string, unknown> = {};
		for (const field of returnFields) {
			fields[field] = getNoteFieldValue(file, cache, field);
		}
		
		// Add built-in properties for sorting/display
		fields['basename'] = file.basename;
		fields['path'] = file.path;
		fields['ctime'] = file.stat.ctime;
		fields['mtime'] = file.stat.mtime;

		results.push({ file, fields });
	}

	// 6. Sort
	if (sort && sort.key) {
		results.sort((a, b) => {
			let valA = a.fields[sort.key];
			let valB = b.fields[sort.key];
			
			// Fallback to field value if not collected in fields
			if (valA === undefined) {
				valA = getNoteFieldValue(a.file, ctx.plugin.app.metadataCache.getFileCache(a.file), sort.key);
			}
			if (valB === undefined) {
				valB = getNoteFieldValue(b.file, ctx.plugin.app.metadataCache.getFileCache(b.file), sort.key);
			}

			if (valA === valB) return 0;
			const isMissingA = valA === undefined || valA === null;
			const isMissingB = valB === undefined || valB === null;
			if (isMissingA && isMissingB) return 0;
			if (isMissingA) return sort.dir === 'asc' ? 1 : -1;
			if (isMissingB) return sort.dir === 'asc' ? -1 : 1;

			let comparison = 0;
			if (typeof valA === 'string' && typeof valB === 'string') {
				comparison = valA.localeCompare(valB);
			} else {
				comparison = (valA as number) > (valB as number) ? 1 : -1;
			}
			return sort.dir === 'asc' ? comparison : -comparison;
		});
	}

	// 7. Limit
	const limitedResults = results.slice(0, limit);

	if (limitedResults.length === 0) {
		return { content: [{ type: 'text', text: 'No notes found matching the criteria.' }] };
	}

	// 8. Format as Markdown Table
	// Collect headers
	const headers = ['File', ...returnFields];
	
	// Create table header
	let mdTable = '| ' + headers.join(' | ') + ' |\n';
	mdTable += '| ' + headers.map(() => '---').join(' | ') + ' |\n';

	// Create rows
	for (const { file, fields } of limitedResults) {
		const row = [file.path];
		for (const field of returnFields) {
			let val = fields[field];
			if (val === undefined || val === null) val = '';
			else if (Array.isArray(val)) val = val.join(', ');
			else if (typeof val === 'object') val = JSON.stringify(val);
			row.push(String(val).replace(/\|/g, '\\|').replace(/\n/g, ' '));
		}
		mdTable += '| ' + row.join(' | ') + ' |\n';
	}

	const summary = `Found ${results.length} results (showing ${limitedResults.length}):\n\n`;

	return { content: [{ type: 'text', text: applyReadLimit(summary + mdTable, ctx.limitRead) }] };
};
