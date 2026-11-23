<script lang="ts">
	import type { App } from "obsidian";
	import { getLanguage } from "../../../../shared/locales/helpers";
	import type { tStore } from "../../../../shared/locales/index";
	import type {
		SplitLayoutMode,
		SplitSlotConfig,
		SplitTurn,
		SplitWinnerChoice,
	} from "../../../../shared/types/splitChat.types";
	import { copyToClipboard } from "../../../../shared/utils/clipboardUtils";
	import { formatTime } from "../../../../shared/utils/dateUtils";
	import { iconAction } from "../../../../shared/utils/domUtils";
	import AttachmentChips from "../../ui/AttachmentChips.svelte";
	import MessageEditArea from "../../ui/MessageEditArea.svelte";
	import RagProgressIndicator from "../../ui/RagProgressIndicator.svelte";
	import RagSources from "../../ui/RagSources.svelte";
	import SplitResponseCard from "./SplitResponseCard.svelte";

	const BLIND_POSITION_LABELS = ["A", "B", "C", "D"] as const;

	let {
		turn,
		slots,
		mode,
		isCompact,
		activeMobileSlotId,
		app,
		tStore: tS,
		onEditTurn,
		onStopSlot,
		onRetrySlot,
		onVoteWinner,
		onRevealTurn,
		onContinueInChat,
		onExpandResponse,
	}: {
		turn: SplitTurn;
		slots: SplitSlotConfig[];
		mode: SplitLayoutMode;
		isCompact: boolean;
		activeMobileSlotId: string | null;
		app: App;
		tStore: typeof tStore;
		onEditTurn: (turnId: string, newContent: string) => void;
		onStopSlot: (turnId: string, slotId: string) => void;
		onRetrySlot: (turnId: string, slotId: string) => void;
		onVoteWinner: (turnId: string, winner: SplitWinnerChoice) => void;
		onRevealTurn: (turnId: string) => void;
		onContinueInChat: (slotId: string) => void;
		onExpandResponse: (turnId: string, slotId: string) => void;
	} = $props();

	let isEditing = $state(false);

	const isMasked = $derived(mode === "blind" && !turn.isRevealed);

	const orderedSlotIds = $derived.by(() => {
		if (isMasked && turn.blindOrder && turn.blindOrder.length > 0) {
			return turn.blindOrder.filter((sid) => Boolean(turn.responses[sid]));
		}
		const fromSlots = slots
			.map((s) => s.slotId)
			.filter((sid) => Boolean(turn.responses[sid]));
		const extraIds = Object.keys(turn.responses).filter(
			(sid) => !fromSlots.includes(sid),
		);
		return [...fromSlots, ...extraIds];
	});

	const visibleSlotIds = $derived.by(() => {
		if (!isCompact) return orderedSlotIds;
		if (activeMobileSlotId && orderedSlotIds.includes(activeMobileSlotId)) {
			return [activeMobileSlotId];
		}
		return orderedSlotIds.slice(0, 1);
	});

	const isTurnSettled = $derived(
		turn.ragStep === null &&
			orderedSlotIds.every((sid) => {
				const st = turn.responses[sid]?.status;
				return st !== "waiting" && st !== "streaming";
			}),
	);

	const fastestSlotId = $derived.by(() => {
		const doneList = orderedSlotIds
			.map((sid) => turn.responses[sid])
			.filter(
				(r) =>
					r &&
					r.status === "done" &&
					typeof r.metrics?.durationMs === "number",
			);
		if (doneList.length < 2) return null;
		let minResp = doneList[0];
		for (const r of doneList) {
			if ((r.metrics.durationMs ?? Infinity) < (minResp.metrics.durationMs ?? Infinity)) {
				minResp = r;
			}
		}
		return minResp.slotId;
	});

	function getSlotLabel(slotId: string, idx: number): string {
		const found = slots.find((s) => s.slotId === slotId);
		return found?.label ?? BLIND_POSITION_LABELS[idx] ?? String(idx + 1);
	}

	function getMaskedLabel(idx: number): string {
		return BLIND_POSITION_LABELS[idx] ?? String(idx + 1);
	}

	async function copyPrompt(): Promise<void> {
		await copyToClipboard(
			turn.userMessage.content,
			$tS("uiMessages.copiedToClipboard"),
		);
	}

	function handleSaveEdit(newContent: string): void {
		isEditing = false;
		onEditTurn(turn.id, newContent);
	}
</script>

<div class="lumina-split-turn">
	<!-- 라운드 공통 질문 -->
	<div class="lumina-split-turn__prompt">
		<div class="lumina-split-turn__prompt-head">
			<span class="lumina-split-turn__role">👤 You</span>
			<div class="lumina-split-turn__prompt-meta">
				<span class="lumina-split-turn__time">
					{formatTime(turn.userMessage.timestamp, getLanguage())}
				</span>
				{#if !isEditing}
					<button
						type="button"
						class="clickable-icon lumina-split-turn__prompt-btn"
						aria-label={$tS("common.copy")}
						title={$tS("common.copy")}
						onclick={copyPrompt}
						use:iconAction={"copy"}
					></button>
					<button
						type="button"
						class="clickable-icon lumina-split-turn__prompt-btn"
						aria-label={$tS("uiMessages.edit")}
						title={$tS("uiMessages.edit")}
						onclick={() => (isEditing = true)}
						use:iconAction={"pencil"}
					></button>
				{/if}
			</div>
		</div>

		{#if isEditing}
			<MessageEditArea
				{app}
				content={turn.userMessage.content}
				onSave={handleSaveEdit}
				onCancel={() => (isEditing = false)}
			/>
		{:else}
			{#if turn.userMessage.attachments && turn.userMessage.attachments.length > 0}
				<AttachmentChips attachments={turn.userMessage.attachments} {app} />
			{/if}
			<div class="lumina-split-turn__prompt-text">{turn.userMessage.content}</div>
		{/if}

		{#if turn.ragStep}
			<div class="lumina-split-turn__rag-wrap">
				<RagProgressIndicator step={turn.ragStep} {app} />
			</div>
		{/if}

		{#if turn.ragSources && turn.ragSources.length > 0}
			<RagSources sources={turn.ragSources} {app} />
		{/if}
	</div>

	<!-- 모델별 응답 Grid -->
	<div
		class="lumina-split-turn__grid"
		style:grid-template-columns={`repeat(${Math.max(1, visibleSlotIds.length)}, minmax(0, 1fr))`}
	>
		{#each visibleSlotIds as sid (sid)}
			{@const resp = turn.responses[sid]}
			{@const fullIdx = orderedSlotIds.indexOf(sid)}
			{#if resp}
				<SplitResponseCard
					response={resp}
					slotLabel={getSlotLabel(sid, fullIdx)}
					maskedLabel={getMaskedLabel(fullIdx)}
					{isMasked}
					isWinner={turn.winnerSlotId === sid}
					isFastest={fastestSlotId === sid}
					{app}
					tStore={tS}
					onStop={() => onStopSlot(turn.id, sid)}
					onRetry={() => onRetrySlot(turn.id, sid)}
					onPickWinner={() =>
						onVoteWinner(turn.id, turn.winnerSlotId === sid ? null : sid)}
					onContinueInChat={() => onContinueInChat(sid)}
					onExpand={() => onExpandResponse(turn.id, sid)}
				/>
			{/if}
		{/each}
	</div>

	<!-- Blind Arena 투표 바 -->
	{#if isMasked && isTurnSettled}
		<div class="lumina-split-turn__vote-bar">
			<span class="lumina-split-turn__vote-label">
				🎭 {$tS("splitChat.blindVotePrompt")}
			</span>
			<div class="lumina-split-turn__vote-actions">
				{#each orderedSlotIds as sid, idx (sid)}
					{@const maskedName = $tS("splitChat.blindModelLabel", {
						label: getMaskedLabel(idx),
					})}
					<button
						type="button"
						class="lumina-split-turn__vote-btn"
						onclick={() => onVoteWinner(turn.id, sid)}
					>
						{$tS("splitChat.voteSlotWin", { label: maskedName })}
					</button>
				{/each}
				<button
					type="button"
					class="lumina-split-turn__vote-btn"
					onclick={() => onVoteWinner(turn.id, "tie")}
				>
					🤝 {$tS("splitChat.voteTie")}
				</button>
				<button
					type="button"
					class="lumina-split-turn__vote-btn"
					onclick={() => onVoteWinner(turn.id, "both_bad")}
				>
					👎 {$tS("splitChat.voteBothBad")}
				</button>
				<button
					type="button"
					class="lumina-split-turn__vote-btn lumina-split-turn__vote-btn--reveal"
					onclick={() => onRevealTurn(turn.id)}
				>
					👀 {$tS("splitChat.revealModels")}
				</button>
			</div>
		</div>
	{:else if turn.winnerSlotId === "tie" || turn.winnerSlotId === "both_bad"}
		<div class="lumina-split-turn__vote-result">
			{turn.winnerSlotId === "tie"
				? `🤝 ${$tS("splitChat.voteTie")}`
				: `👎 ${$tS("splitChat.voteBothBad")}`}
		</div>
	{/if}
</div>

<style>
	.lumina-split-turn {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.lumina-split-turn__prompt {
		padding: 10px 14px;
		border-radius: 10px;
		background: var(--background-secondary-alt);
		border: 1px solid var(--background-modifier-border);
	}

	.lumina-split-turn__prompt-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		margin-bottom: 6px;
	}

	.lumina-split-turn__role {
		font-size: 11px;
		font-weight: 700;
		color: var(--text-muted);
		text-transform: uppercase;
		letter-spacing: 0.04em;
	}

	.lumina-split-turn__prompt-meta {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.lumina-split-turn__time {
		font-size: 10px;
		color: var(--text-faint);
	}

	.lumina-split-turn__prompt-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 22px;
		height: 22px;
		padding: 0;
		border-radius: 5px;
		border: none;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
	}

	.lumina-split-turn__prompt-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.lumina-split-turn__prompt-btn :global(svg) {
		width: 13px;
		height: 13px;
	}

	.lumina-split-turn__prompt-text {
		font-size: 13px;
		line-height: 1.55;
		color: var(--text-normal);
		white-space: pre-wrap;
		word-break: break-word;
	}

	.lumina-split-turn__rag-wrap {
		margin-top: 8px;
	}

	.lumina-split-turn__grid {
		display: grid;
		gap: 12px;
		align-items: stretch;
	}

	.lumina-split-turn__vote-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		flex-wrap: wrap;
		gap: 8px;
		padding: 8px 12px;
		border-radius: 8px;
		background: color-mix(in srgb, var(--interactive-accent) 8%, var(--background-secondary));
		border: 1px solid color-mix(in srgb, var(--interactive-accent) 25%, var(--background-modifier-border));
	}

	.lumina-split-turn__vote-label {
		font-size: 12px;
		font-weight: 600;
		color: var(--text-normal);
	}

	.lumina-split-turn__vote-actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
	}

	.lumina-split-turn__vote-btn {
		all: unset;
		box-sizing: border-box;
		padding: 4px 10px;
		border-radius: 6px;
		font-size: 11px;
		font-weight: 600;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		color: var(--text-normal);
		cursor: pointer;
		transition: all 0.15s ease;
	}

	.lumina-split-turn__vote-btn:hover {
		border-color: var(--interactive-accent);
		color: var(--interactive-accent);
	}

	.lumina-split-turn__vote-btn--reveal {
		background: var(--interactive-accent);
		border-color: var(--interactive-accent);
		color: var(--text-on-accent);
	}

	.lumina-split-turn__vote-btn--reveal:hover {
		opacity: 0.9;
		color: var(--text-on-accent);
	}

	.lumina-split-turn__vote-result {
		align-self: flex-start;
		padding: 3px 10px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
		background: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
	}
</style>
