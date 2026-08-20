import { Notice } from 'obsidian';
import type { ToolArguments, ToolResult } from '../toolTypes';

export async function showNoticeHandler(args: ToolArguments): Promise<ToolResult> {
	const message = args.message as string;
	const duration = args.duration as number | undefined;

	if (!message) {
		return {
			isError: true,
			content: [{ type: 'text', text: 'Message for notice is missing.' }],
		};
	}

	new Notice(message, duration);

	return {
		content: [{ type: 'text', text: 'Notice shown.' }],
	};
}
