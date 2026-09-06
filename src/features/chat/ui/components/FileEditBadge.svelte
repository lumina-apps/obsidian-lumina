<script lang="ts">
	import type { App } from 'obsidian';
	import type { AutopilotFileEditLog } from '../../../../shared/types/autopilot.types';
	import { iconAction } from '../../../../shared/utils/domUtils';
	import { CliDiffModal } from './CliDiffModal';
	import { tStore } from '../../../../shared/locales/index';

	let {
		fileEdit,
		app,
		onOpen,
	}: {
		fileEdit: AutopilotFileEditLog;
		app: App;
		onOpen?: (path: string) => void;
	} = $props();

	function getActionIcon(action: AutopilotFileEditLog['action']): string {
		switch (action) {
			case 'create':
				return 'file-plus';
			case 'delete':
				return 'file-minus';
			default:
				return 'file-edit';
		}
	}

	function handleOpenDiff(e: MouseEvent) {
		e.stopPropagation();
		const modal = new CliDiffModal(app, fileEdit);
		modal.open();
	}
</script>

<div class="lumina-autopilot-file-edit">
	<span class="lumina-autopilot-file-edit__icon" use:iconAction={getActionIcon(fileEdit.action)}></span>
	<span class="lumina-autopilot-file-edit__action">{fileEdit.action}</span>
	<button
		class="lumina-autopilot-file-edit__path"
		onclick={() => onOpen?.(fileEdit.path)}
		type="button"
		title={fileEdit.path}
	>
		{fileEdit.path}
	</button>
	<button
		class="lumina-autopilot-file-edit__diff-btn"
		onclick={handleOpenDiff}
		type="button"
		title={$tStore('settings.cli.viewDiff') || 'View Diff'}
	>
		<span use:iconAction={'git-compare'}></span>
		<span>{$tStore('settings.cli.viewDiff') || 'Diff'}</span>
	</button>
</div>

<style>
	.lumina-autopilot-file-edit {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 3px 8px;
		background: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		font-size: 11px;
		margin: 2px 4px 2px 0;
	}

	.lumina-autopilot-file-edit__icon {
		display: flex;
		align-items: center;
		color: var(--text-muted);
	}

	.lumina-autopilot-file-edit__action {
		text-transform: uppercase;
		font-size: 9px;
		font-weight: 700;
		color: var(--text-accent);
		background: var(--background-modifier-border);
		padding: 1px 4px;
		border-radius: 2px;
	}

	.lumina-autopilot-file-edit__path {
		background: none;
		border: none;
		padding: 0;
		color: var(--text-normal);
		cursor: pointer;
		font-family: var(--font-monospace);
		text-decoration: underline;
		text-underline-offset: 2px;
		max-width: 200px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lumina-autopilot-file-edit__path:hover {
		color: var(--text-accent);
	}

	.lumina-autopilot-file-edit__diff-btn {
		display: inline-flex;
		align-items: center;
		gap: 3px;
		background: var(--background-modifier-hover);
		border: 1px solid var(--background-modifier-border);
		border-radius: 3px;
		padding: 1px 6px;
		font-size: 10px;
		color: var(--text-muted);
		cursor: pointer;
	}

	.lumina-autopilot-file-edit__diff-btn:hover {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
	}
</style>

