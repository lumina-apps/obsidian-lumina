<script lang="ts">
	import { settingsStore } from "../../../core/store/settingsStore";
	import { tStore } from "../../../shared/locales/index";
	import { iconAction, clickOutside } from "../../../shared/utils/domUtils";
	import { openSettingsTab } from "../../../shared/utils/openSettingsTab";
	import type LuminaPlugin from "../../../main";
	import QuickSettingsGroup from "./lib/quickSettings/QuickSettingsGroup.svelte";
	import { TEMPERATURE_PRESETS, TOKEN_PRESETS } from "./lib/quickSettings/constants";
	import type { PresetItem } from "./lib/quickSettings/QuickSettingsGroup.svelte";

	let { plugin, isOpen = $bindable(false) } = $props<{ plugin: LuminaPlugin; isOpen: boolean }>();

	// ── Store derived 값 직접 참조 (local state 복사 제거) ──────────
	let systemPrompts = $derived($settingsStore?.chat.systemPrompts ?? []);
	let activePromptId = $derived($settingsStore?.chat.activeSystemPromptId ?? "default");
	let temperature = $derived($settingsStore?.chat.temperature ?? 0.7);
	let maxTokens = $derived($settingsStore?.chat.maxOutputTokens ?? 4000);

	// ── Preset → 번역된 레이블 주입 ──────────────────────────────────
	function buildPresets(presets: typeof TEMPERATURE_PRESETS): PresetItem[] {
		return presets.map((p) => ({
			value: p.value,
			threshold: p.threshold,
			label: $tStore(`settings.chat.quickSettings.${p.i18nKey}` as Parameters<typeof $tStore>[0]),
		}));
	}

	// ── 설정 저장 ────────────────────────────────────────────────────
	async function saveSettings(updates: Partial<{
		activeSystemPromptId: string;
		temperature: number;
		maxOutputTokens: number;
	}>) {
		Object.assign(plugin.settings.chat, updates);
		await plugin.saveSettings();
	}

	function handlePromptChange(e: Event) {
		const target = e.target as HTMLSelectElement;
		saveSettings({ activeSystemPromptId: target.value });
	}

	function closePopup() {
		isOpen = false;
	}
</script>

{#if isOpen}
	<!--
		role="presentation" + stopPropagation 유지.
		clickOutside action이 외부 클릭 감지 → closePopup 호출.
	-->
	<div
		class="lumina-qs"
		role="presentation"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
		use:clickOutside={closePopup}
	>
		<!-- 시스템 프롬프트 선택 -->
		<div class="lumina-qs__section">
			<label class="lumina-qs__label" for="qs-system-prompt">
				{$tStore("settings.chat.quickSettings.systemPrompt" as Parameters<typeof $tStore>[0])}
			</label>
			<select
				id="qs-system-prompt"
				class="lumina-qs__select"
				value={activePromptId}
				onchange={handlePromptChange}
			>
				{#each systemPrompts as prompt}
					<option value={prompt.id}>{prompt.name}</option>
				{/each}
			</select>
		</div>

		<!-- 온도 버튼 그룹 -->
		<QuickSettingsGroup
			label={$tStore("settings.chat.quickSettings.temperature" as Parameters<typeof $tStore>[0])}
			labelId="qs-temp-label"
			presets={buildPresets(TEMPERATURE_PRESETS)}
			currentValue={temperature}
			onSelect={(val) => saveSettings({ temperature: val })}
		/>

		<!-- 최대 토큰 버튼 그룹 -->
		<QuickSettingsGroup
			label={$tStore("settings.chat.quickSettings.maxLength" as Parameters<typeof $tStore>[0])}
			labelId="qs-max-label"
			presets={buildPresets(TOKEN_PRESETS)}
			currentValue={maxTokens}
			onSelect={(val) => saveSettings({ maxOutputTokens: val })}
		/>

		<!-- 전체 설정 열기 -->
		<div class="lumina-qs__footer">
			<button
				class="lumina-qs__full-settings"
				onclick={() => {
					closePopup();
					openSettingsTab(plugin.app, "lumina");
				}}
			>
				<span class="lumina-qs__icon" use:iconAction={"settings"}></span>
				{$tStore("settings.chat.quickSettings.allSettings" as Parameters<typeof $tStore>[0])}
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