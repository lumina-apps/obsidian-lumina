import { describe, it, expect, vi, afterEach } from "vitest";
import { buildSlashCommands } from "./slashCommandUtils";
import { BUILTIN_SLASH_COMMAND_IDS } from "../../../shared/utils/slashCommandId";
import type LuminaPlugin from "../../../main";
import {
	resetEntitlementState,
	setEntitlementState,
} from "../../../core/store/entitlementStore";

describe("slashCommandUtils", () => {
	const mockPlugin = {} as LuminaPlugin;
	const mockT = vi.fn((key: string) => `trans_${key}`);

	afterEach(() => {
		resetEntitlementState();
	});

	it("should build all slash commands including mode command", () => {
		const onClearChat = vi.fn();
		const onToggleRagMode = vi.fn();
		const onOpenSettings = vi.fn();
		const setShowMcpPopup = vi.fn();
		const setShowModelPicker = vi.fn();
		const setShowPromptPicker = vi.fn();
		const onToggleWebSearch = vi.fn();
		const onExportChat = vi.fn();
		const onRegenerateLast = vi.fn();
		const onCompressContext = vi.fn();
		const onToggleAgentExecutionMode = vi.fn();

		const cmds = buildSlashCommands(
			mockPlugin,
			mockT,
			onClearChat,
			onToggleRagMode,
			onOpenSettings,
			setShowMcpPopup,
			setShowModelPicker,
			setShowPromptPicker,
			onToggleWebSearch,
			onExportChat,
			onRegenerateLast,
			onCompressContext,
			onToggleAgentExecutionMode,
		);

		expect(cmds).toHaveLength(11);

		const cmdIds = cmds.map((c) => c.id);
		expect(cmdIds).toEqual([...BUILTIN_SLASH_COMMAND_IDS]);
		expect(cmdIds).toEqual([
			"clear",
			"rag",
			"websearch",
			"mode",
			"export",
			"regenerate",
			"compress",
			"mcp",
			"model",
			"prompt",
			"settings",
		]);

		const modeCmd = cmds.find((c) => c.id === "mode");
		expect(modeCmd).toBeDefined();
		expect(modeCmd?.name).toBe("trans_chat.slashCommands.mode.name");
		expect(modeCmd?.description).toBe("trans_chat.slashCommands.mode.desc");
		expect(modeCmd?.icon).toBe("edit-2");

		// Execute mode command action
		modeCmd?.action();
		expect(onToggleAgentExecutionMode).toHaveBeenCalledTimes(1);
	});

	it("should trigger corresponding callbacks for other commands", () => {
		const onClearChat = vi.fn();
		const onToggleRagMode = vi.fn();
		const onOpenSettings = vi.fn();
		const setShowMcpPopup = vi.fn();
		const setShowModelPicker = vi.fn();
		const setShowPromptPicker = vi.fn();
		const onToggleWebSearch = vi.fn();
		const onExportChat = vi.fn();
		const onRegenerateLast = vi.fn();
		const onCompressContext = vi.fn();
		const onToggleAgentExecutionMode = vi.fn();

		const cmds = buildSlashCommands(
			mockPlugin,
			mockT,
			onClearChat,
			onToggleRagMode,
			onOpenSettings,
			setShowMcpPopup,
			setShowModelPicker,
			setShowPromptPicker,
			onToggleWebSearch,
			onExportChat,
			onRegenerateLast,
			onCompressContext,
			onToggleAgentExecutionMode,
		);

		cmds.find((c) => c.id === "clear")?.action();
		expect(onClearChat).toHaveBeenCalledTimes(1);

		cmds.find((c) => c.id === "rag")?.action();
		expect(onToggleRagMode).toHaveBeenCalledTimes(1);

		cmds.find((c) => c.id === "websearch")?.action();
		expect(onToggleWebSearch).toHaveBeenCalledTimes(1);

		cmds.find((c) => c.id === "export")?.action();
		expect(onExportChat).toHaveBeenCalledTimes(1);

		cmds.find((c) => c.id === "regenerate")?.action();
		expect(onRegenerateLast).toHaveBeenCalledTimes(1);

		cmds.find((c) => c.id === "compress")?.action();
		expect(onCompressContext).toHaveBeenCalledTimes(1);

		cmds.find((c) => c.id === "mcp")?.action();
		expect(setShowMcpPopup).toHaveBeenCalledWith(true);

		cmds.find((c) => c.id === "model")?.action();
		expect(setShowModelPicker).toHaveBeenCalledWith(true);

		cmds.find((c) => c.id === "prompt")?.action();
		expect(setShowPromptPicker).toHaveBeenCalledWith(true);

		cmds.find((c) => c.id === "settings")?.action();
		expect(onOpenSettings).toHaveBeenCalledTimes(1);
	});

	it("Pro 비활성 시에는 onOpenSplitChat이 전달되어도 /arena 명령어를 노출하지 않는다", () => {
		resetEntitlementState();
		const onOpenSplitChat = vi.fn();
		const cmds = buildSlashCommands(
			mockPlugin,
			mockT,
			vi.fn(),
			vi.fn(),
			vi.fn(),
			vi.fn(),
			vi.fn(),
			vi.fn(),
			vi.fn(),
			vi.fn(),
			vi.fn(),
			vi.fn(),
			vi.fn(),
			onOpenSplitChat,
		);
		expect(cmds).toHaveLength(11);
		expect(cmds.find((c) => c.id === "arena")).toBeUndefined();
	});

	it("Pro 활성 시에만 /arena 명령어를 추가하고 실행한다", () => {
		setEntitlementState({
			tier: "pro",
			status: "active",
			enabledFeatures: new Set(["split-chat"]),
		});
		const onOpenSplitChat = vi.fn();
		const cmds = buildSlashCommands(
			mockPlugin,
			mockT,
			vi.fn(),
			vi.fn(),
			vi.fn(),
			vi.fn(),
			vi.fn(),
			vi.fn(),
			vi.fn(),
			vi.fn(),
			vi.fn(),
			vi.fn(),
			vi.fn(),
			onOpenSplitChat,
		);
		expect(cmds).toHaveLength(12);
		const arenaCmd = cmds.find((c) => c.id === "arena");
		expect(arenaCmd).toBeDefined();
		expect(arenaCmd?.icon).toBe("lumina-split-chat");
		arenaCmd?.action();
		expect(onOpenSplitChat).toHaveBeenCalledTimes(1);
	});
});

