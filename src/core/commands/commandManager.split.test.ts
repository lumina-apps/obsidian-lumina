import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type LuminaPlugin from '../../main';
import { DEFAULT_SETTINGS } from '../settings/defaultSettings';
import { CommandManager } from './commandManager';
import {
	resetEntitlementState,
	setEntitlementState,
} from '../store/entitlementStore';
import * as viewHelper from '../views/viewHelper';
import { SPLIT_CHAT_VIEW_TYPE } from '../../shared/constants/viewTypes';

function createMockPluginForCommands() {
	const registeredCommands: Array<{ id: string; name: string; callback?: () => void }> = [];
	const removeCommand = vi.fn();

	const plugin = {
		manifest: { id: 'obsidian-lumina' },
		app: {
			vault: { getAbstractFileByPath: vi.fn() },
			workspace: { getActiveFile: vi.fn().mockReturnValue(null) },
			commands: { removeCommand },
		},
		settings: JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as typeof DEFAULT_SETTINGS,
		addCommand: vi.fn((cmd: { id: string; name: string; callback?: () => void }) => {
			registeredCommands.push(cmd);
		}),
	} as unknown as LuminaPlugin;

	return { plugin, registeredCommands, removeCommand };
}

describe('CommandManager Pro Split 동적 커맨드 게이트', () => {
	beforeEach(() => {
		resetEntitlementState();
	});

	afterEach(() => {
		resetEntitlementState();
		vi.restoreAllMocks();
	});

	it('Pro 비활성 상태에서는 open-split-chat 커맨드가 아예 등록되지 않아야 한다', () => {
		const { plugin, registeredCommands } = createMockPluginForCommands();
		const cm = new CommandManager(plugin);
		cm.registerCommands();

		expect(registeredCommands.some((c) => c.id === 'open-split-chat')).toBe(false);
	});

	it('Pro 활성화 시 open-split-chat을 동적 등록하고 비활성화 시 removeCommand로 제거한다', () => {
		const { plugin, registeredCommands, removeCommand } = createMockPluginForCommands();
		const activateSpy = vi.spyOn(viewHelper, 'activateMainView').mockResolvedValue(undefined);

		const cm = new CommandManager(plugin);
		cm.registerCommands();
		expect(registeredCommands.some((c) => c.id === 'open-split-chat')).toBe(false);

		setEntitlementState({
			tier: 'pro',
			status: 'active',
			enabledFeatures: new Set(['split-chat']),
		});
		cm.syncProCommands();

		const splitCmd = registeredCommands.find((c) => c.id === 'open-split-chat');
		expect(splitCmd).toBeDefined();
		splitCmd?.callback?.();
		expect(activateSpy).toHaveBeenCalledWith(plugin.app.workspace, SPLIT_CHAT_VIEW_TYPE);

		resetEntitlementState();
		cm.syncProCommands();
		expect(removeCommand).toHaveBeenCalledWith('obsidian-lumina:open-split-chat');
	});
});
