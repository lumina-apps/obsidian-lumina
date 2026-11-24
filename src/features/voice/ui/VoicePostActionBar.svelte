<script lang="ts">
	import { Platform } from "obsidian";
	import { hasProFeature } from "../../../core/store/entitlementStore";
	import { voiceStore } from "../../../core/store/voiceStore";
	import { tStore } from "../../../shared/locales/index";
	import type { VoiceTemplateId } from "../../../shared/types/voice.types";
	import { icon } from "../../../shared/utils/iconAction";
	import type { VoiceNoteManager } from "../voiceManager";

	let { manager }: { manager: VoiceNoteManager } = $props();

	const state = $derived($voiceStore);
	const isProVoice = hasProFeature("voice-note");
	const isMobile = Platform.isMobile;
	const isVisible = $derived(state.status === "review" && state.reviewResult !== null);

	function handleTemplateSelect(ev: Event): void {
		const target = ev.currentTarget as HTMLSelectElement;
		const nextTpl = target.value as VoiceTemplateId;
		if (!$isProVoice && nextTpl !== "verbatim") {
			target.value = "verbatim";
		}
		void manager.reprocessWithTemplate(nextTpl);
	}
</script>

{#if isVisible && state.reviewResult}
	<div
		class="lumina-voice-review-wrap"
		class:is-mobile={isMobile}
		role="region"
		aria-label={$tStore("voiceNote.recorder.title")}
	>
		<div class="lumina-voice-review-bar">
			<button
				type="button"
				class="lumina-voice-rbtn lumina-voice-rbtn--primary"
				onclick={() => manager.applyReview()}
			>
				<span use:icon={"check"}></span>
				<span>{$tStore("voiceNote.review.applyBtn")}</span>
			</button>

			<label class="lumina-voice-reprocess">
				<span class="lumina-voice-reprocess-label">
					{$tStore("voiceNote.review.reprocessLabel")}
				</span>
				<select
					class="lumina-voice-rselect"
					value={$isProVoice ? state.reviewResult.templateId : "verbatim"}
					onchange={handleTemplateSelect}
					aria-label={$tStore("voiceNote.review.reprocessLabel")}
				>
					<option value="verbatim">{$tStore("voiceNote.templates.verbatim")}</option>
					<option value="clean">
						{$tStore("voiceNote.templates.clean")}{!$isProVoice ? " 🔒 PRO" : ""}
					</option>
					<option value="meeting">
						{$tStore("voiceNote.templates.meeting")}{!$isProVoice ? " 🔒 PRO" : ""}
					</option>
				</select>
			</label>

			{#if $isProVoice}
				<button
					type="button"
					class="lumina-voice-rbtn"
					onclick={() => void manager.replaceWithRawTranscriptOnly()}
				>
					{$tStore("voiceNote.review.rawOnlyBtn")}
				</button>
			{/if}

			<button
				type="button"
				class="lumina-voice-rbtn lumina-voice-rbtn--danger"
				onclick={() => void manager.undoReview()}
			>
				<span use:icon={"undo-2"}></span>
				<span>{$tStore("voiceNote.review.undoBtn")}</span>
			</button>
		</div>
	</div>
{/if}

<style>
	.lumina-voice-review-wrap {
		position: fixed;
		bottom: 24px;
		left: 50%;
		transform: translateX(-50%);
		z-index: var(--layer-modal, 60);
		max-width: calc(100vw - 24px);
	}

	.lumina-voice-review-wrap.is-mobile {
		bottom: calc(64px + env(safe-area-inset-bottom, 0px));
		max-width: min(680px, calc(100vw - 32px));
	}

	.lumina-voice-review-bar {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 8px 12px;
		border-radius: 12px;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		box-shadow: var(--shadow-s, 0 8px 24px rgba(0, 0, 0, 0.2));
		flex-wrap: wrap;
	}

	/* 좁은 화면(스마트폰 <= 600px)에서만 하단 전체 폭으로 확장 */
	@media (max-width: 600px) {
		.lumina-voice-review-wrap.is-mobile {
			left: 12px;
			right: 12px;
			transform: none;
			max-width: none;
		}

		.is-mobile .lumina-voice-review-bar {
			justify-content: space-between;
		}
	}

	.lumina-voice-rbtn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		height: 30px;
		padding: 0 10px;
		border-radius: 6px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		color: var(--text-normal);
		font-size: var(--font-ui-small, 12px);
		cursor: pointer;
	}

	.lumina-voice-rbtn:hover {
		background: var(--background-modifier-hover);
	}

	.lumina-voice-rbtn--primary {
		background: var(--interactive-accent);
		border-color: var(--interactive-accent);
		color: var(--text-on-accent);
		font-weight: 600;
	}

	.lumina-voice-rbtn--danger:hover {
		color: var(--text-error);
		border-color: var(--text-error);
	}

	.lumina-voice-reprocess {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		font-size: var(--font-ui-smaller, 12px);
		color: var(--text-muted);
	}

	.lumina-voice-rselect {
		height: 30px;
		padding: 0 8px;
		border-radius: 6px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		color: var(--text-normal);
		font-size: var(--font-ui-smaller, 12px);
	}

	.is-mobile .lumina-voice-rbtn,
	.is-mobile .lumina-voice-rselect {
		min-height: 38px;
	}
</style>
