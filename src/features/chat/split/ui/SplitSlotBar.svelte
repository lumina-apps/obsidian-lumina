<script lang="ts">
	import type {
		FavoriteModel,
		LLMProviderConfig,
	} from "../../../../shared/types/settings.types";
	import type {
		SplitLayoutMode,
		SplitSlotConfig,
		SplitTurn,
	} from "../../../../shared/types/splitChat.types";
	import type { tStore } from "../../../../shared/locales/index";
	import { clickOutside, iconAction } from "../../../../shared/utils/domUtils";
	import ModelSelector from "../../ui/ModelSelector.svelte";
	import { getSlotAccentColor } from "../splitSlotUtils";

	let {
		slots,
		providers,
		favoriteModels,
		mode,
		turns,
		globalTemperature,
		isCompact,
		activeMobileSlotId,
		isStreaming,
		minSlots,
		tStore: tS,
		onSelectModel,
		onChangeTemperature,
		onRemoveSlot,
		onToggleFavorite,
		onSelectMobileSlot,
		onRevealAll,
	}: {
		slots: SplitSlotConfig[];
		providers: LLMProviderConfig[];
		favoriteModels: FavoriteModel[];
		mode: SplitLayoutMode;
		turns: SplitTurn[];
		globalTemperature: number;
		isCompact: boolean;
		activeMobileSlotId: string | null;
		isStreaming: boolean;
		minSlots: number;
		tStore: typeof tStore;
		onSelectModel: (slotId: string, providerId: string, modelId: string) => void;
		onChangeTemperature: (slotId: string, temp: number | undefined) => void;
		onRemoveSlot: (slotId: string) => void;
		onToggleFavorite: (providerId: string, modelId: string) => void;
		onSelectMobileSlot: (slotId: string) => void;
		onRevealAll: () => void;
	} = $props();

	let openTempSlotId = $state<string | null>(null);

	const hasUnrevealedTurns = $derived(
		mode === "blind" && turns.some((t) => !t.isRevealed),
	);

	const activeMobileSlot = $derived(
		slots.find((s) => s.slotId === activeMobileSlotId) ?? slots[0] ?? null,
	);

	const latestTurn = $derived(turns.length > 0 ? turns[turns.length - 1] : null);

	function getSlotStatusDot(slotId: string): string {
		if (!latestTurn) return "idle";
		return latestTurn.responses[slotId]?.status ?? "idle";
	}

	function toggleTempPopover(e: MouseEvent, slotId: string): void {
		e.stopPropagation();
		openTempSlotId = openTempSlotId === slotId ? null : slotId;
	}

	function closeTempPopover(): void {
		openTempSlotId = null;
	}
</script>

{#if slots.length > 0}
	<div class="lumina-split-slotbar">
		{#if hasUnrevealedTurns}
			<div class="lumina-split-slotbar__blind-banner">
				<span>🎭 {$tS("splitChat.modeBlind")} — {$tS("splitChat.blindHidden")}</span>
				{#if !isStreaming}
					<button
						type="button"
						class="lumina-split-slotbar__reveal-btn"
						onclick={onRevealAll}
					>
						👀 {$tS("splitChat.revealModels")}
					</button>
				{/if}
			</div>
		{:else if isCompact}
			<!-- 좁은 화면/모바일: 상단 세그먼트 탭 + 활성 슬롯 모델 컨트롤 -->
			<div class="lumina-split-slotbar__mobile">
				<div class="lumina-split-slotbar__mobile-tabs">
					{#each slots as slot (slot.slotId)}
						{@const status = getSlotStatusDot(slot.slotId)}
						<button
							type="button"
							class="lumina-split-slotbar__mobile-tab"
							class:is-active={activeMobileSlot?.slotId === slot.slotId}
							onclick={() => onSelectMobileSlot(slot.slotId)}
						>
							<span
								class="lumina-split-slotbar__dot"
								style:background={getSlotAccentColor(slot.label)}
							></span>
							<span>{slot.label}</span>
							<span class="lumina-split-slotbar__mini-model">{slot.modelId}</span>
							{#if status === "streaming" || status === "waiting"}
								<span class="lumina-split-slotbar__pulse"></span>
							{:else if status === "error"}
								<span class="lumina-split-slotbar__err-mark">!</span>
							{/if}
						</button>
					{/each}
				</div>

				{#if activeMobileSlot}
					<div class="lumina-split-slotbar__mobile-controls">
						<div class="lumina-split-slotbar__selector-wrap">
							<ModelSelector
								{providers}
								{favoriteModels}
								selectedProviderId={activeMobileSlot.providerId}
								selectedModelId={activeMobileSlot.modelId}
								dropdownAlign="left"
								onSelect={(pid, mid) =>
									onSelectModel(activeMobileSlot.slotId, pid, mid)}
								{onToggleFavorite}
							/>
						</div>

						<div class="lumina-split-slotbar__temp-wrap">
							<button
								type="button"
								class="clickable-icon lumina-split-slotbar__tool-btn"
								class:is-overridden={activeMobileSlot.temperatureOverride !== undefined}
								title={$tS("splitChat.temperature")}
								onclick={(e) => toggleTempPopover(e, activeMobileSlot.slotId)}
							>
								<span use:iconAction={"thermometer"}></span>
								{#if activeMobileSlot.temperatureOverride !== undefined}
									<span class="lumina-split-slotbar__temp-val">
										{activeMobileSlot.temperatureOverride.toFixed(1)}
									</span>
								{/if}
							</button>

							{#if openTempSlotId === activeMobileSlot.slotId}
								<div
									class="lumina-split-slotbar__temp-popover"
									role="presentation"
									use:clickOutside={closeTempPopover}
									onclick={(e) => e.stopPropagation()}
								>
									<div class="lumina-split-slotbar__temp-head">
										<span>{$tS("splitChat.temperature")}</span>
										<strong>
											{(
												activeMobileSlot.temperatureOverride ??
												globalTemperature
											).toFixed(1)}
										</strong>
									</div>
									<input
										type="range"
										min="0"
										max="2"
										step="0.1"
										value={activeMobileSlot.temperatureOverride ?? globalTemperature}
										oninput={(e) => {
											const val = parseFloat(
												(e.target as HTMLInputElement).value,
											);
											onChangeTemperature(activeMobileSlot.slotId, val);
										}}
									/>
									<button
										type="button"
										class="lumina-split-slotbar__temp-reset"
										onclick={() => {
											onChangeTemperature(activeMobileSlot.slotId, undefined);
											closeTempPopover();
										}}
									>
										{$tS("splitChat.temperatureReset")}
									</button>
								</div>
							{/if}
						</div>

						{#if slots.length > minSlots}
							<button
								type="button"
								class="clickable-icon lumina-split-slotbar__tool-btn lumina-split-slotbar__remove-btn"
								disabled={isStreaming}
								aria-label={$tS("splitChat.removeModel")}
								title={$tS("splitChat.removeModel")}
								onclick={() => onRemoveSlot(activeMobileSlot.slotId)}
								use:iconAction={"x"}
							></button>
						{/if}
					</div>
				{/if}
			</div>
		{:else}
			<!-- 데스크탑 넓은 화면: N열 Grid 슬롯 바 -->
			<div
				class="lumina-split-slotbar__grid"
				style:grid-template-columns={`repeat(${slots.length}, minmax(0, 1fr))`}
			>
				{#each slots as slot, idx (slot.slotId)}
					<div class="lumina-split-slotbar__cell">
						<span
							class="lumina-split-slotbar__badge"
							style:background={getSlotAccentColor(slot.label)}
						>
							{slot.label}
						</span>

						<div class="lumina-split-slotbar__selector-wrap">
							<ModelSelector
								{providers}
								{favoriteModels}
								selectedProviderId={slot.providerId}
								selectedModelId={slot.modelId}
								dropdownAlign={idx === 0 ? "left" : "right"}
								onSelect={(pid, mid) => onSelectModel(slot.slotId, pid, mid)}
								{onToggleFavorite}
							/>
						</div>

						<div class="lumina-split-slotbar__temp-wrap">
							<button
								type="button"
								class="clickable-icon lumina-split-slotbar__tool-btn"
								class:is-overridden={slot.temperatureOverride !== undefined}
								aria-label={$tS("splitChat.temperature")}
								title={slot.temperatureOverride !== undefined
									? `${$tS("splitChat.temperature")}: ${slot.temperatureOverride.toFixed(1)}`
									: $tS("splitChat.temperatureDefault", {
											temp: globalTemperature.toFixed(1),
										})}
								onclick={(e) => toggleTempPopover(e, slot.slotId)}
							>
								<span use:iconAction={"thermometer"}></span>
								{#if slot.temperatureOverride !== undefined}
									<span class="lumina-split-slotbar__temp-val">
										{slot.temperatureOverride.toFixed(1)}
									</span>
								{/if}
							</button>

							{#if openTempSlotId === slot.slotId}
								<div
									class="lumina-split-slotbar__temp-popover"
									class:is-left-edge={idx === 0}
									role="presentation"
									use:clickOutside={closeTempPopover}
									onclick={(e) => e.stopPropagation()}
								>
									<div class="lumina-split-slotbar__temp-head">
										<span>{$tS("splitChat.temperature")}</span>
										<strong>
											{(slot.temperatureOverride ?? globalTemperature).toFixed(1)}
										</strong>
									</div>
									<input
										type="range"
										min="0"
										max="2"
										step="0.1"
										value={slot.temperatureOverride ?? globalTemperature}
										oninput={(e) => {
											const val = parseFloat(
												(e.target as HTMLInputElement).value,
											);
											onChangeTemperature(slot.slotId, val);
										}}
									/>
									<button
										type="button"
										class="lumina-split-slotbar__temp-reset"
										onclick={() => {
											onChangeTemperature(slot.slotId, undefined);
											closeTempPopover();
										}}
									>
										{$tS("splitChat.temperatureReset")}
									</button>
								</div>
							{/if}
						</div>

						{#if slots.length > minSlots}
							<button
								type="button"
								class="clickable-icon lumina-split-slotbar__tool-btn lumina-split-slotbar__remove-btn"
								disabled={isStreaming}
								aria-label={$tS("splitChat.removeModel")}
								title={$tS("splitChat.removeModel")}
								onclick={() => onRemoveSlot(slot.slotId)}
								use:iconAction={"x"}
							></button>
						{/if}
					</div>
				{/each}
			</div>
		{/if}
	</div>
{/if}

<style>
	.lumina-split-slotbar {
		padding: 8px 14px;
		background: var(--background-primary);
		border-bottom: 1px solid var(--background-modifier-border);
		flex-shrink: 0;
		z-index: 20;
	}

	.lumina-split-slotbar__grid {
		display: grid;
		gap: 12px;
		align-items: center;
	}

	.lumina-split-slotbar__cell {
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		padding: 4px 8px;
		border-radius: 8px;
		background: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
	}

	.lumina-split-slotbar__badge {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 20px;
		height: 20px;
		border-radius: 50%;
		color: #ffffff;
		font-size: 11px;
		font-weight: 700;
		flex-shrink: 0;
	}

	.lumina-split-slotbar__selector-wrap {
		flex: 1;
		min-width: 0;
	}

	.lumina-split-slotbar__selector-wrap :global(.lumina-model-selector) {
		width: 100%;
	}

	.lumina-split-slotbar__temp-wrap {
		position: relative;
		flex-shrink: 0;
	}

	.lumina-split-slotbar__tool-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 3px;
		height: 24px;
		padding: 0 5px;
		border-radius: 5px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--text-muted);
		font-size: 10.5px;
		font-weight: 600;
		cursor: pointer;
	}

	.lumina-split-slotbar__tool-btn:hover:not(:disabled) {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.lumina-split-slotbar__tool-btn.is-overridden {
		color: var(--interactive-accent);
		background: color-mix(in srgb, var(--interactive-accent) 12%, transparent);
		border-color: color-mix(in srgb, var(--interactive-accent) 30%, transparent);
	}

	.lumina-split-slotbar__tool-btn :global(svg) {
		width: 13px;
		height: 13px;
	}

	.lumina-split-slotbar__remove-btn:hover:not(:disabled) {
		color: var(--text-error);
		background: var(--background-modifier-error-hover);
	}

	.lumina-split-slotbar__remove-btn:disabled {
		opacity: 0.35;
		cursor: not-allowed;
	}

	.lumina-split-slotbar__temp-val {
		font-variant-numeric: tabular-nums;
	}

	.lumina-split-slotbar__temp-popover {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		width: 190px;
		padding: 10px;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		box-shadow: 0 6px 20px rgba(0, 0, 0, 0.2);
		z-index: 120;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.lumina-split-slotbar__temp-popover.is-left-edge {
		left: 0;
		right: auto;
	}

	.lumina-split-slotbar__temp-head {
		display: flex;
		justify-content: space-between;
		align-items: center;
		font-size: 11px;
		color: var(--text-muted);
	}

	.lumina-split-slotbar__temp-head strong {
		color: var(--text-normal);
		font-variant-numeric: tabular-nums;
	}

	.lumina-split-slotbar__temp-popover input[type="range"] {
		width: 100%;
	}

	.lumina-split-slotbar__temp-reset {
		all: unset;
		box-sizing: border-box;
		text-align: center;
		padding: 4px 8px;
		border-radius: 5px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		background: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		cursor: pointer;
	}

	.lumina-split-slotbar__temp-reset:hover {
		color: var(--text-normal);
		background: var(--background-modifier-hover);
	}

	.lumina-split-slotbar__blind-banner {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 6px 12px;
		border-radius: 8px;
		background: color-mix(in srgb, var(--interactive-accent) 10%, var(--background-secondary));
		border: 1px dashed color-mix(in srgb, var(--interactive-accent) 45%, transparent);
		font-size: 12px;
		font-weight: 600;
		color: var(--text-normal);
	}

	.lumina-split-slotbar__reveal-btn {
		all: unset;
		box-sizing: border-box;
		padding: 4px 10px;
		border-radius: 6px;
		font-size: 11px;
		font-weight: 600;
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		cursor: pointer;
	}

	.lumina-split-slotbar__mobile {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.lumina-split-slotbar__mobile-tabs {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		padding-bottom: 2px;
	}

	.lumina-split-slotbar__mobile-tab {
		all: unset;
		box-sizing: border-box;
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 10px;
		border-radius: 7px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		color: var(--text-muted);
		font-size: 11.5px;
		font-weight: 600;
		cursor: pointer;
		max-width: 170px;
		flex-shrink: 0;
	}

	.lumina-split-slotbar__mobile-tab.is-active {
		color: var(--text-normal);
		border-color: var(--interactive-accent);
		background: color-mix(in srgb, var(--interactive-accent) 12%, var(--background-secondary));
	}

	.lumina-split-slotbar__dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.lumina-split-slotbar__mini-model {
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-weight: 500;
		font-size: 11px;
	}

	.lumina-split-slotbar__pulse {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--interactive-accent);
		animation: splitSlotPulse 1.2s infinite;
		flex-shrink: 0;
	}

	@keyframes splitSlotPulse {
		0%, 100% { opacity: 0.4; }
		50% { opacity: 1; }
	}

	.lumina-split-slotbar__err-mark {
		color: var(--text-error);
		font-weight: 800;
	}

	.lumina-split-slotbar__mobile-controls {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	/* 모바일 슬롯 바 툴 버튼 터치 영역 확대 */
	:global(body.is-mobile) .lumina-split-slotbar {
		padding: 8px 10px;
	}

	:global(body.is-mobile) .clickable-icon.lumina-split-slotbar__tool-btn {
		min-width: 30px;
		min-height: 30px;
		height: 30px;
		padding: 0 7px;
		box-shadow: none;
	}

	:global(body.is-mobile) .lumina-split-slotbar__temp-reset {
		height: auto;
		box-shadow: none;
		padding: 4px 8px;
	}
</style>
