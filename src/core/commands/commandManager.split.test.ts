import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type LuminaPlugin from '../../main';
import { DEFAULT_SETTINGS } from '../settings/defaultSettings';
import { CommandManager } from './commandManager';
import {
	resetEntitlementState,
	setEntitlementState,
	setReleasedFeatures,
} from '../store/entitlementStore';
import * as viewHelper from '../views/viewHelper';
import { BATCH_STUDIO_VIEW_TYPE, SPLIT_CHAT_VIEW_TYPE } from '../../shared/constants/viewTypes';

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

	it('Pro Batch Studio 활성화 시 open-batch-studio와 open-orphan-notes를 동적 등록하고 비활성화 시 제거한다', async () => {
		const { getBatchState, resetBatchStore } = await import('../store/batchStore');
		resetBatchStore();

		const { plugin, registeredCommands, removeCommand } = createMockPluginForCommands();
		const activateSpy = vi.spyOn(viewHelper, 'activateMainView').mockResolvedValue(undefined);

		const cm = new CommandManager(plugin);
		cm.registerCommands();
		expect(registeredCommands.some((c) => c.id === 'open-batch-studio')).toBe(false);
		expect(registeredCommands.some((c) => c.id === 'open-orphan-notes')).toBe(false);

		setEntitlementState({
			tier: 'pro',
			status: 'active',
			enabledFeatures: new Set(['batch-studio']),
		});
		cm.syncProCommands();

		const batchCmd = registeredCommands.find((c) => c.id === 'open-batch-studio');
		const orphanCmd = registeredCommands.find((c) => c.id === 'open-orphan-notes');
		expect(batchCmd).toBeDefined();
		expect(orphanCmd).toBeDefined();

		batchCmd?.callback?.();
		expect(activateSpy).toHaveBeenCalledWith(plugin.app.workspace, BATCH_STUDIO_VIEW_TYPE);

		orphanCmd?.callback?.();
		expect(getBatchState().activeMainTab).toBe('orphans');
		expect(activateSpy).toHaveBeenCalledTimes(2);

		resetEntitlementState();
		cm.syncProCommands();
		expect(removeCommand).toHaveBeenCalledWith('obsidian-lumina:open-batch-studio');
		expect(removeCommand).toHaveBeenCalledWith('obsidian-lumina:open-orphan-notes');
		resetBatchStore();
	});

	it('Pro Voice-to-Note 비활성 시 미등록, 활성 시 3개 동적 등록(process-pending-voice-notes 포함), 해제 시 모두 제거한다', async () => {
		const { plugin, registeredCommands, removeCommand } = createMockPluginForCommands();
		const mockManager = {
			toggleRecording: vi.fn().mockResolvedValue(undefined),
			openAudioFilePicker: vi.fn(),
			processAllPendingItems: vi.fn().mockResolvedValue(undefined),
		};
		const ensureSpy = vi.fn().mockResolvedValue(mockManager);
		(plugin as unknown as { ensureVoiceNoteManager: () => Promise<unknown> }).ensureVoiceNoteManager = ensureSpy;

		const cm = new CommandManager(plugin);
		cm.registerCommands();
		expect(registeredCommands.some((c) => c.id === 'toggle-voice-note-recording')).toBe(false);
		expect(registeredCommands.some((c) => c.id === 'transcribe-audio-file')).toBe(false);
		expect(registeredCommands.some((c) => c.id === 'process-pending-voice-notes')).toBe(false);

		setEntitlementState({
			tier: 'pro',
			status: 'active',
			enabledFeatures: new Set(['voice-note']),
		});
		cm.syncProCommands();

		const toggleCmd = registeredCommands.find((c) => c.id === 'toggle-voice-note-recording');
		const uploadCmd = registeredCommands.find((c) => c.id === 'transcribe-audio-file');
		const pendingCmd = registeredCommands.find((c) => c.id === 'process-pending-voice-notes');
		expect(toggleCmd).toBeDefined();
		expect(uploadCmd).toBeDefined();
		expect(pendingCmd).toBeDefined();

		toggleCmd?.callback?.();
		uploadCmd?.callback?.();
		pendingCmd?.callback?.();
		await new Promise((r) => setTimeout(r, 0));

		expect(ensureSpy).toHaveBeenCalledTimes(3);
		expect(mockManager.toggleRecording).toHaveBeenCalledTimes(1);
		expect(mockManager.openAudioFilePicker).toHaveBeenCalledTimes(1);
		expect(mockManager.processAllPendingItems).toHaveBeenCalledTimes(1);

		resetEntitlementState();
		cm.syncProCommands();
		expect(removeCommand).toHaveBeenCalledWith('obsidian-lumina:toggle-voice-note-recording');
		expect(removeCommand).toHaveBeenCalledWith('obsidian-lumina:transcribe-audio-file');
		expect(removeCommand).toHaveBeenCalledWith('obsidian-lumina:process-pending-voice-notes');
	});

	it('Freemium(setReleasedFeatures) 모드에서는 릴리즈된 기능의 커맨드만 등록되고 비릴리즈 기능은 등록되지 않는다', () => {
		setReleasedFeatures(['split-chat', 'voice-note']);
		const { plugin, registeredCommands } = createMockPluginForCommands();
		const cm = new CommandManager(plugin);
		cm.registerCommands();

		expect(registeredCommands.some((c) => c.id === 'open-split-chat')).toBe(true);
		expect(registeredCommands.some((c) => c.id === 'toggle-voice-note-recording')).toBe(true);
		expect(registeredCommands.some((c) => c.id === 'process-pending-voice-notes')).toBe(true);
		expect(registeredCommands.some((c) => c.id === 'open-batch-studio')).toBe(false);
		expect(registeredCommands.some((c) => c.id === 'open-orphan-notes')).toBe(false);
	});
});
