import { t } from '../../../shared/locales/helpers';
import type { ToolArguments, ToolHandlerContext, ToolResult, ToolName } from './toolTypes';
import type { PathGuard } from './pathGuard';
import { readActiveNoteHandler, readNoteHandler, readDailyNoteHandler, getBacklinksHandler, getNoteMetadataHandler, listAttachmentsHandler } from './handlers/readHandlers';
import { createNoteHandler, appendToNoteHandler, appendToDailyNoteHandler, replaceNoteHandler, patchNoteHandler, deleteNoteHandler, moveNoteHandler, updateFrontmatterHandler, saveAttachmentHandler } from './handlers/writeHandlers';
import { searchNotesHandler, listNotesHandler, listTagsHandler } from './handlers/searchHandlers';
import { ragSearchHandler } from './handlers/ragHandlers';
import { executeCodeHandler, runNoteCodeBlockHandler, runShellCommandHandler } from './handlers/executeHandlers';
import { createCanvasHandler } from './handlers/canvasHandlers';
import { generateMocHandler } from './handlers/mocHandlers';
import { autoLinkNoteHandler } from './handlers/autoLinkHandlers';

export type ToolHandlerImpl = (
	args: ToolArguments,
	ctx: ToolHandlerContext,
	pathGuard: PathGuard,
) => Promise<ToolResult>;

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
	replace_note: replaceNoteHandler,
	patch_note: patchNoteHandler,
	delete_note: deleteNoteHandler,
	move_note: moveNoteHandler,
	get_backlinks: getBacklinksHandler,
	update_frontmatter: updateFrontmatterHandler,
	get_note_metadata: getNoteMetadataHandler,
	list_attachments: listAttachmentsHandler,
	save_attachment: saveAttachmentHandler,
	execute_code: executeCodeHandler,
	run_note_code_block: runNoteCodeBlockHandler,
	list_tags: listTagsHandler,
	create_canvas: createCanvasHandler,
	generate_moc: generateMocHandler,
	auto_link_note: autoLinkNoteHandler,
	run_shell_command: runShellCommandHandler,
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
	return Promise.resolve({
		isError: true,
		content: [{ type: 'text', text: t('mcpServerTools.common.unknownTool') }],
	});
}