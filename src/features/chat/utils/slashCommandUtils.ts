import type { SlashCommand } from "../types/slashCommand.types";
import type LuminaPlugin from "../../../main";
import { resizeTextarea } from "./textareaUtils";

export function buildSlashCommands(
	plugin: LuminaPlugin,
	t: (key: string, params?: Record<string, string | number>) => string,
	getSlashStartIndex: () => number,
	getInputText: () => string,
	setInputText: (v: string) => void,
	onClearChat: () => void,
	onToggleRagMode: () => void,
	onOpenSettings: () => void,
	setShowMcpPopup: (v: boolean) => void,
	getTextareaEl: () => HTMLTextAreaElement | null,
): SlashCommand[] {
	const cmds: SlashCommand[] = [
		{
			id: "clear",
			name: t("chat.slashCommands.clear.name"),
			description: t("chat.slashCommands.clear.desc"),
			icon: "trash-2",
			action: () => onClearChat(),
		},
		{
			id: "rag",
			name: t("chat.slashCommands.rag.name"),
			description: t("chat.slashCommands.rag.desc"),
			icon: "database",
			action: () => onToggleRagMode(),
		},
		{
			id: "mcp",
			name: t("chat.slashCommands.mcp.name"),
			description: t("chat.slashCommands.mcp.desc"),
			icon: "lumina-server",
			action: () => {
				setShowMcpPopup(true);
			},
		},
		{
			id: "settings",
			name: t("chat.slashCommands.settings.name"),
			description: t("chat.slashCommands.settings.desc"),
			icon: "settings",
			action: () => onOpenSettings(),
		},
	];

	const quickActions = plugin.settings.chat.quickActions || [];
	for (const qa of quickActions) {
		const prompt = qa.prompt;
		cmds.push({
			id: qa.id.replace(/^qa-/, ""),
			name: qa.name,
			description: t("chat.slashCommands.quickActionDesc"),
			icon: "message-square",
			action: () => {
				const startIdx = getSlashStartIndex();
				const currentInput = getInputText();
				const before =
					startIdx === -1
						? currentInput
						: currentInput.slice(0, startIdx);
				const after =
					startIdx === -1
						? ""
						: currentInput.slice(startIdx);
				setInputText(before + prompt + after);
				const el = getTextareaEl();
				if (el) resizeTextarea(el);
			},
		});
	}

	return cmds;
}