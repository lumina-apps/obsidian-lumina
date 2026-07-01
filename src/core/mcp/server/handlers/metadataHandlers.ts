import { TFile, normalizePath, getAllTags, type CachedMetadata } from 'obsidian';
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
	if (!cache || !cache.frontmatter) return undefined;
	return cache.frontmatter[key];
}

function evaluateFilter(actualValue: unknown, filter: Filter): boolean {
	if (actualValue === undefined || actualValue === null) {
		return filter.operator === '!=' || filter.operator === 'not_contains';
	}

	// Normalize target value
	let targetValue: unknown = filter.value;
	if (targetValue === 'true') targetValue = true;
	else if (targetValue === 'false') targetValue = false;
	else if (!isNaN(Number(targetValue))) targetValue = Number(targetValue);

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
	const limit = typeof args.limit === 'number' ? args.limit : 50;

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
			const fileTags = getAllTags(cache || {}) || [];
			const hasAllTags = tags.every(tag => {
				const searchTag = tag.startsWith('#') ? tag : '#' + tag;
				return fileTags.includes(searchTag);
			});
			if (!hasAllTags) continue;
		}

		// 4. Frontmatter filters check
		let passesFilters = true;
		for (const filter of filters) {
			const actualValue = extractFrontmatterValue(cache, filter.key);
			if (!evaluateFilter(actualValue, filter)) {
				passesFilters = false;
				break;
			}
		}

		if (!passesFilters) continue;

		// 5. Collect return fields
		const fields: Record<string, unknown> = {};
		for (const field of returnFields) {
			fields[field] = extractFrontmatterValue(cache, field);
		}
		
		// Add built-in properties for sorting/display
		fields['basename'] = file.basename;
		fields['ctime'] = file.stat.ctime;
		fields['mtime'] = file.stat.mtime;

		results.push({ file, fields });
	}

	// 6. Sort
	if (sort && sort.key) {
		results.sort((a, b) => {
			let valA = a.fields[sort.key!];
			let valB = b.fields[sort.key!];
			
			// Fallback to frontmatter if not collected
			if (valA === undefined && sort.key !== 'basename' && sort.key !== 'ctime' && sort.key !== 'mtime') {
				valA = extractFrontmatterValue(ctx.plugin.app.metadataCache.getFileCache(a.file), sort.key!);
			}
			if (valB === undefined && sort.key !== 'basename' && sort.key !== 'ctime' && sort.key !== 'mtime') {
				valB = extractFrontmatterValue(ctx.plugin.app.metadataCache.getFileCache(b.file), sort.key!);
			}

			if (valA === valB) return 0;
			if (valA === undefined) return sort.dir === 'asc' ? 1 : -1;
			if (valB === undefined) return sort.dir === 'asc' ? -1 : 1;

			const comparison = (valA as number) > (valB as number) ? 1 : -1;
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

	return { content: [{ type: 'text', text: summary + mdTable }] };
};
