<script lang="ts">
	import { tStore } from '../../../../shared/locales/index';
	import type { App } from 'obsidian';

	let { app } = $props<{ app: App }>();

	function handleSettingsOpen() {
		// obsidian-api lacks the typing for `setting` on App, so cast as unknown
		const obsidianApp = app as unknown as { setting: { open: () => void, openTabById: (id: string) => void } };
		obsidianApp.setting.open();
		obsidianApp.setting.openTabById('lumina');
	}
</script>

<div class="lumina-discovery__empty">
	<div class="lumina-discovery__empty-icon">🔍</div>
	<p>{$tStore('discovery.emptyStateText')}</p>
	<p class="lumina-discovery__empty-sub">{$tStore('discovery.emptyStateSub')}</p>
	<button class="lumina-discovery__setup-btn" onclick={handleSettingsOpen}>
		⚙️ {$tStore('common.settings')}
	</button>
</div>

<style>
	.lumina-discovery__empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		padding: 20px;
		text-align: center;
		color: var(--text-muted);
	}

	.lumina-discovery__empty-icon {
		font-size: 32px;
		margin-bottom: 12px;
	}

	.lumina-discovery__empty-sub {
		font-size: 12px;
		opacity: 0.8;
		margin-top: 4px;
	}

	.lumina-discovery__setup-btn {
		margin-top: 16px;
		padding: 6px 12px;
		background: transparent;
		border: 1px solid var(--interactive-accent);
		color: var(--interactive-accent);
		border-radius: 6px;
		cursor: pointer;
	}
</style>
