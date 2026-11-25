<script lang="ts">
	import type { App } from "obsidian";
	import { t } from "../../../shared/locales/helpers";
	import { confirmWithModal } from "../../../shared/utils/modal";

	let {
		app,
		content,
		onSave,
		onCancel,
	}: {
		app?: App;
		content: string;
		onSave: (content: string) => void;
		onCancel: () => void;
	} = $props();

	let editContent = $state("");
	let editTextareaEl: HTMLTextAreaElement | null = $state(null);

	$effect(() => {
		// content가 변경될 때마다 편집 내용 초기화 (편집 모드 진입 시점)
		editContent = content;
	});

	function handleFocus(): void {
		if (!editTextareaEl) return;
		window.setTimeout(() => {
			editTextareaEl?.scrollIntoView({ behavior: "smooth", block: "center" });
		}, 180);
	}

	async function handleConfirmSave(): Promise<void> {
		if (!app || (await confirmWithModal(app, t("uiMessages.saveAndSend"), t("uiMessages.editConfirm")))) {
			onSave(editContent);
		}
	}
</script>

<div class="lumina-message__edit-area">
	<textarea
		bind:this={editTextareaEl}
		bind:value={editContent}
		class="lumina-message__edit-textarea"
		rows="3"
		onfocus={handleFocus}
	></textarea>
	<div class="lumina-message__edit-actions">
		<button class="lumina-message__edit-btn" onclick={onCancel}>{t("common.cancel")}</button>
		<button class="lumina-message__edit-btn lumina-message__edit-btn--primary" onclick={() => void handleConfirmSave()}>{t("uiMessages.saveAndSend")}</button>
	</div>
</div>

<style>
	.lumina-message__edit-area {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 4px;
	}

	.lumina-message__edit-textarea {
		width: 100%;
		background: var(--background-primary);
		border: 1px solid var(--interactive-accent);
		border-radius: 6px;
		padding: 8px;
		color: var(--text-normal);
		font-size: 13px;
		resize: vertical;
		font-family: var(--font-interface);
		box-sizing: border-box;
	}

	.lumina-message__edit-textarea:focus {
		outline: none;
		box-shadow: 0 0 0 2px rgba(139, 92, 246, 0.2);
	}

	.lumina-message__edit-actions {
		display: flex;
		justify-content: flex-end;
		gap: 6px;
	}

	.lumina-message__edit-btn {
		background: var(--background-secondary-alt);
		border: 1px solid var(--background-modifier-border);
		color: var(--text-muted);
		padding: 4px 10px;
		border-radius: 4px;
		font-size: 11px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.lumina-message__edit-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.lumina-message__edit-btn--primary {
		background: var(--interactive-accent);
		color: white;
		border-color: var(--interactive-accent);
	}

	.lumina-message__edit-btn--primary:hover {
		background: var(--interactive-accent-hover);
		color: white;
		border-color: var(--interactive-accent-hover);
	}

	/* 모바일(iOS/Android) 가상 키보드 포커스 시 자동 확대 방지 및 터치 버튼 보정 */
	:global(body.is-mobile) .lumina-message__edit-textarea {
		font-size: 16px;
		line-height: 22px;
	}

	:global(body.is-mobile) .lumina-message__edit-btn {
		min-height: 32px;
		padding: 6px 12px;
		font-size: 12px;
		box-shadow: none;
	}
</style>