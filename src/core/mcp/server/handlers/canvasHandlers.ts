import type { ToolArguments, ToolHandlerContext, ToolResult } from '../toolTypes';
import type { PathGuard } from '../pathGuard';
import { getValidatedPathAndFile, safeCreateFile, safeModifyFile } from './utils/writeHandlerUtils';
import { buildCanvas, type CanvasNodeInput, type CanvasEdgeInput, type LayoutStrategy } from './utils/canvasUtils';

export const createCanvasHandler = async (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
): Promise<ToolResult> => {
	// Parse arguments
	let rawPath = typeof args.path === 'string' ? args.path : '';
	if (!rawPath) {
		return { isError: true, content: [{ type: 'text', text: 'path is required' }] };
	}

	if (!rawPath.endsWith('.canvas')) {
		rawPath += '.canvas';
	}
	
	// Create a shallow copy of args to override path
	const adjustedArgs = { ...args, path: rawPath };

	const nodes = Array.isArray(args.nodes) ? args.nodes as CanvasNodeInput[] : [];
	const edges = Array.isArray(args.edges) ? args.edges as CanvasEdgeInput[] : [];
	const layout = typeof args.layout === 'string' && ['grid', 'horizontal', 'vertical'].includes(args.layout)
		? args.layout as LayoutStrategy
		: 'grid';
	const overwrite = typeof args.overwrite === 'boolean' ? args.overwrite : false;

	const { canvasData, error } = buildCanvas(nodes, edges, layout);
	if (error || !canvasData) {
		return { isError: true, content: [{ type: 'text', text: `Canvas generation error: ${error}` }] };
	}

	const newContent = JSON.stringify(canvasData, null, 2);

	const { path, file, errorResult } = getValidatedPathAndFile(adjustedArgs, ctx, pathGuard, 'path', false, false);
	if (errorResult) return errorResult;

	if (file) {
		if (!overwrite) {
			return { isError: true, content: [{ type: 'text', text: `File already exists at ${path} and overwrite is false.` }] };
		}
		
		const currentContent = await ctx.plugin.app.vault.read(file);
		return safeModifyFile(
			path,
			file,
			currentContent,
			newContent,
			`Successfully modified canvas at ${path}`,
			ctx,
			pathGuard
		);
	} else {
		return safeCreateFile(
			path,
			newContent,
			`Successfully created canvas at ${path}`,
			ctx,
			pathGuard
		);
	}
};
