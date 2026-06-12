<script lang="ts">
	import { setIcon } from "obsidian";
	import { settingsStore } from "../../../core/store/settingsStore";
	import { tStore } from "../../../shared/locales/index";
	import type LuminaPlugin from "../../../main";

	let { plugin, isOpen = $bindable(false) } = $props<{ plugin: LuminaPlugin; isOpen: boolean }>();

	let containerEl: HTMLDivElement | null = $state(null);

	// Derived states from settingsStore
	const systemPrompts = $derived($settingsStore?.chat.systemPrompts || []);
	let activePromptId = $state($settingsStore?.chat.activeSystemPromptId || "default");
	let temperature = $state($settingsStore?.chat.temperature ?? 0.7);
	let maxTokens = $state($settingsStore?.chat.maxOutputTokens ?? 2000);

	// Sync local state when store changes
	$effect(() => {
		if ($settingsStore) {
			activePromptId = $settingsStore.chat.activeSystemPromptId;
			temperature = $settingsStore.chat.temperature;
			maxTokens = $settingsStore.chat.maxOutputTokens;
		}
	});

	async function saveSettings(updates: Partial<{ activeSystemPromptId: string, temperature: number, maxOutputTokens: number }>) {
		if (updates.activeSystemPromptId !== undefined) {
			plugin.settings.chat.activeSystemPromptId = updates.activeSystemPromptId;
			activePromptId = updates.activeSystemPromptId;
		}
		if (updates.temperature !== undefined) {
			plugin.settings.chat.temperature = updates.temperature;
			temperature = updates.temperature;
		}
		if (updates.maxOutputTokens !== undefined) {
			plugin.settings.chat.maxOutputTokens = updates.maxOutputTokens;
			maxTokens = updates.maxOutputTokens;
		}
		await plugin.saveSettings();
	}

	function handlePromptChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		saveSettings({ activeSystemPromptId: target.value });
	}

	function setTemperature(val: number) {
		saveSettings({ temperature: val });
	}

	function setMaxTokens(val: number) {
		saveSettings({ maxOutputTokens: val });
	}

	function openFullSettings() {
		isOpen = false;
		// @ts-ignore
		(plugin.app as any).setting.open();
		// @ts-ignore
		(plugin.app as any).setting.openTabById('lumina');
	}

	// Click outside handler
	function handleClickOutside(e: MouseEvent) {
		if (isOpen && containerEl && !containerEl.contains(e.target as Node)) {
			isOpen = false;
		}
	}

	$effect(() => {
		if (isOpen) {
			setTimeout(() => {
				document.addEventListener("click", handleClickOutside);
			}, 0);
		} else {
			document.removeEventListener("click", handleClickOutside);
		}
		return () => {
			document.removeEventListener("click", handleClickOutside);
		};
	});

	function iconAction(node: HTMLElement, iconId: string) {
		setIcon(node, iconId);
	}
</script>

{#if isOpen}
	<div class="lumina-qs" bind:this={containerEl} role="presentation" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()}>
		<div class="lumina-qs__section">
			<label class="lumina-qs__label" for="qs-system-prompt">{$tStore("settings.chat.quickSettings.systemPrompt")}</label>
			<select id="qs-system-prompt" class="lumina-qs__select" value={activePromptId} onchange={handlePromptChange}>
				{#each systemPrompts as prompt}
					<option value={prompt.id}>{prompt.name}</option>
				{/each}
			</select>
		</div>

		<div class="lumina-qs__section">
			<span class="lumina-qs__label" id="qs-temp-label">{$tStore("settings.chat.quickSettings.temperature")}</span>
			<div class="lumina-qs__btn-group" role="group" aria-labelledby="qs-temp-label">
				<button class="lumina-qs__btn" class:is-active={temperature <= 0.3} onclick={() => setTemperature(0.2)} data-tooltip="0.2">{$tStore("settings.chat.quickSettings.precise")}</button>
				<button class="lumina-qs__btn" class:is-active={temperature > 0.3 && temperature <= 0.7} onclick={() => setTemperature(0.7)} data-tooltip="0.7">{$tStore("settings.chat.quickSettings.balanced")}</button>
				<button class="lumina-qs__btn" class:is-active={temperature > 0.7} onclick={() => setTemperature(1.0)} data-tooltip="1.0">{$tStore("settings.chat.quickSettings.creative")}</button>
			</div>
		</div>

		<div class="lumina-qs__section">
			<span class="lumina-qs__label" id="qs-max-label">{$tStore("settings.chat.quickSettings.maxLength")}</span>
			<div class="lumina-qs__btn-group" role="group" aria-labelledby="qs-max-label">
				<button class="lumina-qs__btn" class:is-active={maxTokens <= 1000} onclick={() => setMaxTokens(500)} data-tooltip="500">{$tStore("settings.chat.quickSettings.short")}</button>
				<button class="lumina-qs__btn" class:is-active={maxTokens > 1000 && maxTokens <= 2500} onclick={() => setMaxTokens(2000)} data-tooltip="2000">{$tStore("settings.chat.quickSettings.medium")}</button>
				<button class="lumina-qs__btn" class:is-active={maxTokens > 2500} onclick={() => setMaxTokens(4000)} data-tooltip="4000">{$tStore("settings.chat.quickSettings.long")}</button>
			</div>
		</div>

		<div class="lumina-qs__footer">
			<button class="lumina-qs__full-settings" onclick={openFullSettings}>
				<span class="lumina-qs__icon" use:iconAction={"settings"}></span>
				{$tStore("settings.chat.quickSettings.allSettings")}
			</button>
		</div>
	</div>
{/if}

<style>
	.lumina-qs {
		position: absolute;
		top: calc(100% + 8px);
		right: 16px;
		width: 260px;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 10px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
		z-index: 1000;
		display: flex;
		flex-direction: column;
		animation: popover-fade-in 0.15s cubic-bezier(0.4, 0, 0.2, 1);
		padding: 12px;
		gap: 12px;
	}

	@keyframes popover-fade-in {
		from {
			opacity: 0;
			transform: translateY(-8px) scale(0.98);
		}
		to {
			opacity: 1;
			transform: translateY(0) scale(1);
		}
	}

	.lumina-qs__section {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.lumina-qs__label {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.05em;
	}

	.lumina-qs__select {
		width: 100%;
		font-size: 12px;
		padding: 6px 8px;
		border-radius: 6px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		color: var(--text-normal);
		outline: none;
		cursor: pointer;
	}

	.lumina-qs__select:focus {
		border-color: var(--interactive-accent);
	}

	.lumina-qs__btn-group {
		display: flex;
		background: var(--background-secondary);
		border-radius: 6px;
		padding: 2px;
		gap: 2px;
	}

	.lumina-qs__btn {
		flex: 1;
		background: transparent;
		border: none;
		border-radius: 4px;
		padding: 4px 0;
		font-size: 11px;
		font-weight: 500;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.2s ease;
		text-align: center;
		position: relative;
	}

	.lumina-qs__btn[data-tooltip]::before {
		content: attr(data-tooltip);
		position: absolute;
		bottom: calc(100% + 4px);
		left: 50%;
		transform: translateX(-50%);
		background: var(--text-normal);
		color: var(--background-primary);
		padding: 3px 6px;
		border-radius: 4px;
		font-size: 11px;
		font-weight: 600;
		white-space: nowrap;
		opacity: 0;
		visibility: hidden;
		pointer-events: none;
		z-index: 10;
		box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
	}

	.lumina-qs__btn[data-tooltip]:hover::before {
		opacity: 1;
		visibility: visible;
	}

	.lumina-qs__btn:hover {
		color: var(--text-normal);
	}

	.lumina-qs__btn.is-active {
		background: var(--interactive-accent);
		color: white;
		font-weight: 600;
		box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
	}

	.lumina-qs__footer {
		margin-top: 4px;
		padding-top: 12px;
		border-top: 1px solid var(--background-modifier-border);
	}

	.lumina-qs__full-settings {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 6px 0;
		background: transparent;
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		color: var(--text-normal);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.lumina-qs__full-settings:hover {
		background: var(--background-modifier-hover);
	}

	.lumina-qs__icon {
		display: flex;
		align-items: center;
		color: var(--text-muted);
	}

	.lumina-qs__icon :global(svg) {
		width: 14px;
		height: 14px;
	}
</style>
