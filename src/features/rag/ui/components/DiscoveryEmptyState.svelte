<script lang="ts">
	import { Platform, type App } from 'obsidian';
	import { tStore } from '../../../../shared/locales/index';

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
	{#if Platform.isMobile}
		<p class="lumina-discovery__empty-mobile">{$tStore('settings.connections.ragEngine.mobileWarning')}</p>
	{/if}
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

	.lumina-discovery__empty-mobile {
		font-size: 12px;
		color: var(--text-warning);
		background: rgba(245, 158, 11, 0.1);
		border: 1px solid rgba(245, 158, 11, 0.3);
		border-radius: 6px;
		padding: 8px 10px;
		margin-top: 8px;
		line-height: 1.45;
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
