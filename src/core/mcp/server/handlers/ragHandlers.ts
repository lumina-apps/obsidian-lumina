import { t } from '../../../../shared/locales/helpers';
import { formatMcpError } from '../../../../shared/utils/mcpUtils';
import { searchVault, formatRagContext } from '../../../../features/rag/search';
import { applyReadLimit, getStringArg, getNumberArg } from '../handlerHelpers';
import type { ToolArguments, ToolHandlerContext, ToolResult } from '../toolTypes';
import type { PathGuard } from '../pathGuard';

export const ragSearchHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	_pathGuard: PathGuard,
): Promise<ToolResult> => {
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

	const topK =
		typeof rawTopK === 'number'
			? Math.min(rawTopK, ctx.maxResults)
			: Math.min(5, ctx.maxResults);
	const minSim =
		typeof rawMinSim === 'number'
			? Math.max(0, Math.min(1, rawMinSim))
			: 0.65;

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
		const summary = t('mcpServerTools.rag_search.summary', {
			count: results.length,
			minSim,
			context,
		});
		return { content: [{ type: 'text', text: applyReadLimit(summary, ctx.limitRead) }] };
	} catch (err) {
		return {
			isError: true,
			content: [
				{
					type: 'text',
					text: t('mcpServerTools.rag_search.error', {
						error: formatMcpError(err).message,
					}),
				},
			],
		};
	}
};