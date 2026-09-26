import { Notice, TFile } from "obsidian";
import type LuminaPlugin from "../../../../main";
import type { ChatController } from "../../chatController";
import type { LLMProviderConfig } from "../../../../shared/types/settings.types";
import { isCliProvider } from "../../../../shared/types/settings.types";
import { settingsStore } from "../../../../core/store/settingsStore";
import { toVaultRelativePath } from "../../utils/llmExecutor";
import { toggleFavoriteModel } from "../../../../shared/utils/modelUtils";
import { t } from "../../../../shared/locales/helpers";

export interface ChatActionsContext {
	getPlugin: () => LuminaPlugin;
	getCtrl: () => ChatController | null;
	getSelectedProviderId: () => string;
	getSelectedModelId: () => string;
	getIsLoading: () => boolean;
	getHasProvider: () => boolean;
	getIsRagEnabled: () => boolean;
	getUseRagContext: () => boolean;
	setUseRagContext: (v: boolean) => void;
	getIncludeActiveNote: () => boolean;
	setIncludeActiveNote: (v: boolean) => void;
	getAgentEnabled: () => boolean;
	getAgentExecutionMode: () => "read" | "edit";
	getIsCliSelected: () => boolean;
	getVerifiedProviders: () => LLMProviderConfig[];
}

/**
 * Notice 알림 및 설정 저장을 동반하는 채팅 액션들을 관리하는 Composable
 */
export function useChatActions(ctx: ChatActionsContext) {
	function toggleActiveNote(): void {
		ctx.setIncludeActiveNote(!ctx.getIncludeActiveNote());
	}

	function toggleRagMode(): void {
		if (!ctx.getIsRagEnabled()) {
			new Notice(
				t("errors.ragDisabledGlobally") || "Global RAG engine is disabled. Turn it on in Settings.",
			);
			return;
		}
		ctx.setUseRagContext(!ctx.getUseRagContext());
	}

	async function toggleAgentExecutionMode(): Promise<void> {
		const agentEnabled = ctx.getAgentEnabled();
		const isCliSelected = ctx.getIsCliSelected();
		const currentMode = ctx.getAgentExecutionMode();
		const plugin = ctx.getPlugin();

		if (!agentEnabled && !isCliSelected) {
			new Notice(
				t("errors.agentDisabledGlobally") ||
					"Agent feature is disabled. Please enable it in Settings first.",
			);
			return;
		}
		const newMode = currentMode === "read" ? "edit" : "read";
		plugin.settings.chat.agentExecutionMode = newMode;
		await plugin.saveSettings();
		settingsStore.set(plugin.settings);
		new Notice(
			newMode === "edit"
				? (isCliSelected
					? (t("chat.cliMode.editModeNotice") || "✏️ CLI Agent: Edit Mode (Allowed to create and edit notes)")
					: (t("uiMessages.agentModeSwitchedToEdit") || "✏️ Agent switched to Edit Mode. (Can create & edit notes)"))
				: (isCliSelected
					? (t("chat.cliMode.readModeNotice") || "👁️ CLI Agent: Read Mode (Read-only, file modifications blocked)")
					: (t("uiMessages.agentModeSwitchedToRead") || "👁️ Agent switched to Read Mode. (Read-only)")),
		);
	}

	async function toggleWebSearch(): Promise<void> {
		const verified = ctx.getVerifiedProviders();
		const currentProvider = verified.find((p) => p.id === ctx.getSelectedProviderId());
		const plugin = ctx.getPlugin();
		if (currentProvider && isCliProvider(currentProvider.type)) {
			new Notice(
				t("uiMessages.webSearchNotNeededForCli") ||
					"ℹ️ CLI agents use their own built-in web search tools.",
			);
			return;
		}
		plugin.settings.webSearch.enabled = !plugin.settings.webSearch.enabled;
		await plugin.saveSettings();
		new Notice(
			plugin.settings.webSearch.enabled
				? t("uiMessages.webSearchEnabled") || "✅ Web search enabled."
				: t("uiMessages.webSearchDisabled") || "🛑 Web search disabled.",
		);
	}

	async function exportChat(): Promise<void> {
		const ctrl = ctx.getCtrl();
		if (!ctrl) return;
		await ctrl.history.exportCurrentSession(ctx.getSelectedProviderId(), ctx.getSelectedModelId());
	}

	async function compressContext(): Promise<void> {
		const ctrl = ctx.getCtrl();
		if (ctx.getIsLoading() || !ctrl || !ctx.getHasProvider()) return;
		const result = await ctrl.compressContext(ctx.getSelectedProviderId(), ctx.getSelectedModelId());
		if (result.status === "ok") {
			new Notice(
				t("uiMessages.contextCompressed", {
					messages: result.messages.toLocaleString(),
					tokens: result.tokens.toLocaleString(),
				}) ||
					`📋 Context compressed: ${result.messages} messages → 1 summary (~${result.tokens} tokens freed).`,
			);
		} else if (result.status === "too-short") {
			new Notice(
				t("uiMessages.tooShortToCompress") ||
					"Not enough conversation to compress.",
			);
		} else {
			new Notice(
				t("uiMessages.compressFailed") || "⚠️ Failed to compress context.",
			);
		}
	}

	function handleOpenFile(path: string): void {
		const plugin = ctx.getPlugin();
		const relPath = toVaultRelativePath(plugin, path);
		const file = plugin.app.vault.getAbstractFileByPath(relPath);
		if (file instanceof TFile) {
			void plugin.app.workspace.getLeaf(false).openFile(file);
		} else {
			new Notice(`File not found: ${path}`);
		}
	}

	async function handleToggleFavorite(providerId: string, modelId: string): Promise<void> {
		const plugin = ctx.getPlugin();
		const current = plugin.settings.connections.favoriteModels ?? [];
		const updated = toggleFavoriteModel(current, providerId, modelId);
		plugin.settings.connections.favoriteModels = updated;
		await plugin.settingsManager.saveSettings();
	}

	return {
		toggleActiveNote,
		toggleRagMode,
		toggleAgentExecutionMode,
		toggleWebSearch,
		exportChat,
		compressContext,
		handleOpenFile,
		handleToggleFavorite,
	};
}
