<script lang="ts">
	import { Platform } from "obsidian";
	import {
		FREE_MAX_VOICE_DURATION_SEC,
		hasProFeature,
	} from "../../../core/store/entitlementStore";
	import { voiceStore } from "../../../core/store/voiceStore";
	import { tStore } from "../../../shared/locales/index";
	import type { VoiceTemplateId } from "../../../shared/types/voice.types";
	import { icon } from "../../../shared/utils/iconAction";
	import { formatTimestamp } from "../llm/voicePrompts";
	import type { VoiceNoteManager } from "../voiceManager";

	let { manager }: { manager: VoiceNoteManager } = $props();

	let showCaptions = $state(false);
	let captionsBoxEl = $state<HTMLDivElement | null>(null);

	const state = $derived($voiceStore);
	const isProVoice = hasProFeature("voice-note");
	const isMobile = Platform.isMobile;
	const isRecordingOrPaused = $derived(
		state.status === "recording" || state.status === "paused",
	);
	const isProcessing = $derived(
		state.status === "transcribing" || state.status === "processing",
	);
	const showRecoveryBanner = $derived(
		state.status === "idle" && state.hasRecoverableSession,
	);
	const readyPendingCount = $derived(
		state.pendingItems.filter((item) => item.status === "ready").length,
	);
	const waitingPendingCount = $derived(
		state.pendingItems.filter((item) => item.status === "waiting-audio").length,
	);
	const showPendingBanner = $derived(
		!isMobile &&
			state.status === "idle" &&
			!showRecoveryBanner &&
			!state.pendingBannerDismissed &&
			state.pendingItems.length > 0,
	);
	const isVisible = $derived(
		isRecordingOrPaused ||
			isProcessing ||
			state.status === "error" ||
			showRecoveryBanner ||
			showPendingBanner,
	);

	// 10개 파형 막대의 시각적 가중치 곡선
	const barWeights = [0.4, 0.65, 0.9, 1.0, 0.8, 0.95, 0.7, 0.85, 0.55, 0.45];

	$effect(() => {
		if (showCaptions && captionsBoxEl && state.liveSegments.length > 0) {
			captionsBoxEl.scrollTop = captionsBoxEl.scrollHeight;
		}
	});

	function handleTemplateChange(ev: Event): void {
		const target = ev.currentTarget as HTMLSelectElement;
		const nextTpl = target.value as VoiceTemplateId;
		if (!$isProVoice && nextTpl !== "verbatim") {
			target.value = "verbatim";
		}
		manager.setTemplateId(nextTpl);
	}
</script>

{#if isVisible}
	<div
		class="lumina-voice-pill-wrap"
		class:is-mobile={isMobile}
		role="region"
		aria-label={$tStore("voiceNote.recorder.title")}
	>
		{#if showRecoveryBanner}
			<div class="lumina-voice-pill lumina-voice-pill--recovery">
				<span class="lumina-voice-icon" use:icon={"lumina-voice-note"}></span>
				<span class="lumina-voice-status-text">{$tStore("voiceNote.recorder.recoverPrompt")}</span>
				<div class="lumina-voice-actions">
					<button
						type="button"
						class="lumina-voice-btn lumina-voice-btn--primary"
						onclick={() => void manager.recoverUnfinishedSession()}
					>
						{$tStore("voiceNote.recorder.recoverBtn")}
					</button>
					<button
						type="button"
						class="lumina-voice-btn"
						onclick={() => void manager.discardUnfinishedSession()}
					>
						{$tStore("voiceNote.recorder.discardRecoverBtn")}
					</button>
				</div>
			</div>
		{:else if showPendingBanner}
			<div class="lumina-voice-pill lumina-voice-pill--recovery">
				<span class="lumina-voice-icon" use:icon={"lumina-voice-note"}></span>
				<span class="lumina-voice-status-text">
					{#if readyPendingCount > 0}
						{$tStore("voiceNote.deferred.bannerReady", { count: readyPendingCount })}
					{:else}
						{$tStore("voiceNote.deferred.bannerWaitingAudio", { count: waitingPendingCount })}
					{/if}
				</span>
				<div class="lumina-voice-actions">
					{#if readyPendingCount > 0}
						<button
							type="button"
							class="lumina-voice-btn lumina-voice-btn--primary"
							onclick={() => void manager.processAllPendingItems()}
						>
							{$tStore("voiceNote.deferred.convertAllBtn")}
						</button>
					{/if}
					<button
						type="button"
						class="lumina-voice-btn"
						onclick={() => manager.dismissPendingBanner()}
					>
						{$tStore("voiceNote.deferred.laterBtn")}
					</button>
				</div>
			</div>
		{:else if state.status === "error"}
			<div class="lumina-voice-pill lumina-voice-pill--error">
				<span class="lumina-voice-icon lumina-voice-icon--error" use:icon={"alert-circle"}></span>
				<span class="lumina-voice-error-text">{state.errorMessage}</span>
				<button
					type="button"
					class="lumina-voice-btn"
					onclick={() => manager.dismissError()}
				>
					{$tStore("voiceNote.recorder.closeError")}
				</button>
			</div>
		{:else if isProcessing}
			<div class="lumina-voice-pill lumina-voice-pill--processing">
				<span class="lumina-voice-spinner" aria-hidden="true"></span>
				<span class="lumina-voice-status-text">
					{state.progressDetail || $tStore("voiceNote.progress.stepTranscribing")}
				</span>
				<button
					type="button"
					class="lumina-voice-btn"
					onclick={() => manager.cancelRecording()}
					title={$tStore("voiceNote.recorder.cancel")}
				>
					{$tStore("voiceNote.recorder.cancel")}
				</button>
			</div>
		{:else if isRecordingOrPaused}
			{#if showCaptions}
				<div class="lumina-voice-captions" bind:this={captionsBoxEl}>
					{#if state.liveSegments.length === 0}
						<div class="lumina-voice-captions-empty">
							{$tStore("voiceNote.recorder.noCaptionsYet")}
						</div>
					{:else}
						{#each state.liveSegments as seg, idx (idx)}
							<div class="lumina-voice-caption-line">
								<span class="lumina-voice-caption-ts">[{formatTimestamp(seg.startSec)}]</span>
								<span>{seg.text}</span>
							</div>
						{/each}
					{/if}
				</div>
			{/if}

			<div class="lumina-voice-pill">
				<div class="lumina-voice-left">
					<span
						class="lumina-voice-dot"
						class:is-paused={state.status === "paused"}
						aria-label={state.status === "paused"
							? $tStore("voiceNote.recorder.paused")
							: $tStore("voiceNote.recorder.recording")}
					></span>

					<div class="lumina-voice-waveform" aria-hidden="true">
						{#each barWeights as weight, i (i)}
							{@const pct =
								state.status === "recording"
									? Math.max(18, Math.min(100, Math.round(18 + state.audioLevel * weight * 82)))
									: 18}
							<span class="lumina-voice-bar" style="height: {pct}%"></span>
						{/each}
					</div>

					<span class="lumina-voice-timer">
						{formatTimestamp(state.elapsedSec)}{#if !$isProVoice} / {formatTimestamp(FREE_MAX_VOICE_DURATION_SEC)}{/if}
					</span>
				</div>

				<div class="lumina-voice-controls">
					<select
						class="lumina-voice-select"
						value={$isProVoice ? state.templateId : "verbatim"}
						onchange={handleTemplateChange}
						aria-label={$tStore("voiceNote.settings.defaultTemplate.name")}
					>
						<option value="verbatim">{$tStore("voiceNote.templates.verbatim")}</option>
						<option value="clean">
							{$tStore("voiceNote.templates.clean")}{!$isProVoice ? " 🔒 PRO" : ""}
						</option>
						<option value="meeting">
							{$tStore("voiceNote.templates.meeting")}{!$isProVoice ? " 🔒 PRO" : ""}
						</option>
					</select>

					{#if !state.isDeferredCapture}
						<button
							type="button"
							class="lumina-voice-btn"
							class:is-active={showCaptions}
							onclick={() => {
								showCaptions = !showCaptions;
								manager.setCaptionsEnabled?.(showCaptions);
							}}
						>
							{$tStore("voiceNote.recorder.captionsToggle")}
						</button>
					{/if}

					{#if state.status === "recording"}
						<button
							type="button"
							class="lumina-voice-btn lumina-voice-btn--icon"
							onclick={() => manager.pauseRecording()}
							title={$tStore("voiceNote.recorder.pause")}
							aria-label={$tStore("voiceNote.recorder.pause")}
						>
							<span use:icon={"pause"}></span>
						</button>
					{:else}
						<button
							type="button"
							class="lumina-voice-btn lumina-voice-btn--icon"
							onclick={() => manager.resumeRecording()}
							title={$tStore("voiceNote.recorder.resume")}
							aria-label={$tStore("voiceNote.recorder.resume")}
						>
							<span use:icon={"play"}></span>
						</button>
					{/if}

					<button
						type="button"
						class="lumina-voice-btn lumina-voice-btn--primary"
						onclick={() => void manager.stopAndProcess()}
					>
						{state.isDeferredCapture
							? $tStore("voiceNote.deferred.stopAndSave")
							: $tStore("voiceNote.recorder.stopAndProcess")}
					</button>

					<button
						type="button"
						class="lumina-voice-btn lumina-voice-btn--icon"
						onclick={() => manager.cancelRecording()}
						title={$tStore("voiceNote.recorder.cancel")}
						aria-label={$tStore("voiceNote.recorder.cancel")}
					>
						<span use:icon={"x"}></span>
					</button>
				</div>
			</div>

			{#if isMobile}
				<div class="lumina-voice-mobile-hint">
					{state.isDeferredCapture
						? $tStore("voiceNote.deferred.mobileDeferredHint")
						: $tStore("voiceNote.recorder.mobileScreenHint")}
				</div>
			{/if}
		{/if}
	</div>
{/if}

<style>
	.lumina-voice-pill-wrap {
		position: fixed;
		bottom: 24px;
		left: 50%;
		transform: translateX(-50%);
		z-index: var(--layer-modal, 60);
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 8px;
		pointer-events: none;
		max-width: calc(100vw - 24px);
	}

	.lumina-voice-pill-wrap.is-mobile {
		bottom: calc(64px + env(safe-area-inset-bottom, 0px));
		max-width: min(680px, calc(100vw - 32px));
	}

	.lumina-voice-pill {
		pointer-events: auto;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 8px 12px;
		border-radius: 999px;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		box-shadow: var(--shadow-s, 0 8px 24px rgba(0, 0, 0, 0.2));
		color: var(--text-normal);
		font-size: var(--font-ui-small, 13px);
		flex-wrap: wrap;
	}

	/* 좁은 화면(스마트폰 <= 600px)에서만 화면 전체 폭 확장 및 컨트롤 2행 배치 */
	@media (max-width: 600px) {
		.lumina-voice-pill-wrap.is-mobile {
			left: 12px;
			right: 12px;
			transform: none;
			max-width: none;
		}

		.is-mobile .lumina-voice-pill {
			width: 100%;
			justify-content: space-between;
			border-radius: 14px;
			padding: 10px 12px;
		}
	}

	.lumina-voice-left {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.lumina-voice-dot {
		width: 9px;
		height: 9px;
		border-radius: 50%;
		background: var(--text-error, #e05252);
		animation: lumina-voice-pulse 1.3s ease-in-out infinite;
		flex-shrink: 0;
	}

	.lumina-voice-dot.is-paused {
		background: var(--text-muted);
		animation: none;
	}

	.lumina-voice-waveform {
		display: flex;
		align-items: center;
		gap: 2px;
		height: 18px;
	}

	.lumina-voice-bar {
		width: 2.5px;
		border-radius: 2px;
		background: var(--interactive-accent);
		transition: height 75ms linear;
	}

	.lumina-voice-timer {
		font-variant-numeric: tabular-nums;
		font-weight: 600;
		min-width: 42px;
		white-space: nowrap;
	}

	.lumina-voice-controls,
	.lumina-voice-actions {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.lumina-voice-select {
		height: 28px;
		padding: 0 8px;
		border-radius: 6px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		color: var(--text-normal);
		font-size: var(--font-ui-smaller, 12px);
	}

	.lumina-voice-btn {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 4px;
		height: 28px;
		padding: 0 10px;
		border-radius: 6px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		color: var(--text-normal);
		font-size: var(--font-ui-smaller, 12px);
		cursor: pointer;
	}

	.lumina-voice-btn:hover {
		background: var(--background-modifier-hover);
	}

	.lumina-voice-btn.is-active {
		border-color: var(--interactive-accent);
		color: var(--interactive-accent);
	}

	.lumina-voice-btn--primary {
		background: var(--interactive-accent);
		border-color: var(--interactive-accent);
		color: var(--text-on-accent);
		font-weight: 600;
	}

	.lumina-voice-btn--primary:hover {
		background: var(--interactive-accent-hover, var(--interactive-accent));
	}

	.lumina-voice-btn--icon {
		width: 28px;
		padding: 0;
	}

	.is-mobile .lumina-voice-btn,
	.is-mobile .lumina-voice-select {
		min-height: 38px;
	}

	.is-mobile .lumina-voice-btn--icon {
		min-width: 38px;
	}

	/* 좁은 화면(스마트폰 <= 600px)에서만 컨트롤 줄바꿈·우측 정렬 및 상태 메시지 폭 확장 */
	@media (max-width: 600px) {
		.is-mobile .lumina-voice-controls,
		.is-mobile .lumina-voice-actions {
			flex-wrap: wrap;
			width: 100%;
			justify-content: flex-end;
			gap: 8px;
		}

		.is-mobile .lumina-voice-status-text,
		.is-mobile .lumina-voice-error-text {
			flex: 1 1 120px;
			min-width: 0;
			max-width: 100%;
		}
	}

	.lumina-voice-captions {
		pointer-events: auto;
		width: min(460px, 92vw);
		max-height: 150px;
		overflow-y: auto;
		padding: 10px 12px;
		border-radius: 10px;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		box-shadow: var(--shadow-s, 0 6px 18px rgba(0, 0, 0, 0.16));
		font-size: var(--font-ui-small, 13px);
		line-height: 1.45;
	}

	.lumina-voice-captions-empty {
		color: var(--text-muted);
		font-style: italic;
	}

	.lumina-voice-caption-line {
		margin-bottom: 4px;
	}

	.lumina-voice-caption-ts {
		color: var(--text-muted);
		font-size: var(--font-ui-smaller, 11px);
		margin-right: 6px;
		font-variant-numeric: tabular-nums;
	}

	.lumina-voice-spinner {
		width: 14px;
		height: 14px;
		border-radius: 50%;
		border: 2px solid var(--background-modifier-border);
		border-top-color: var(--interactive-accent);
		animation: lumina-voice-spin 0.8s linear infinite;
		flex-shrink: 0;
	}

	.lumina-voice-status-text,
	.lumina-voice-error-text {
		color: var(--text-normal);
		max-width: 300px;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lumina-voice-error-text {
		color: var(--text-error);
	}

	.lumina-voice-icon {
		display: inline-flex;
		align-items: center;
		color: var(--interactive-accent);
	}

	.lumina-voice-icon--error {
		color: var(--text-error);
	}

	.lumina-voice-mobile-hint {
		font-size: 11px;
		color: var(--text-muted);
		background: var(--background-primary);
		padding: 2px 8px;
		border-radius: 6px;
	}

	@keyframes lumina-voice-pulse {
		0%, 100% {
			opacity: 1;
			transform: scale(1);
		}
		50% {
			opacity: 0.45;
			transform: scale(0.85);
		}
	}

	@keyframes lumina-voice-spin {
		to {
			transform: rotate(360deg);
		}
	}
</style>
