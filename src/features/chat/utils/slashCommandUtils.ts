import type { SlashCommand } from "../types/slashCommand.types";
import type LuminaPlugin from "../../../main";

export function buildSlashCommands(
	_plugin: LuminaPlugin,
	t: (key: string, params?: Record<string, string | number>) => string,
	onClearChat: () => void,
	onToggleRagMode: () => void,
	onOpenSettings: () => void,
	setShowMcpPopup: (v: boolean) => void,
	setShowModelPicker: (v: boolean) => void,
	setShowPromptPicker: (v: boolean) => void,
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
			id: "model",
			name: t("chat.slashCommands.model.name"),
			description: t("chat.slashCommands.model.desc"),
			icon: "cpu",
			action: () => {
				setShowModelPicker(true);
			},
		},
		{
			id: "prompt",
			name: t("chat.slashCommands.prompt.name"),
			description: t("chat.slashCommands.prompt.desc"),
			icon: "book-open",
			action: () => {
				setShowPromptPicker(true);
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

	return cmds;
}