<script lang="ts">
	import { t } from "../../../shared/locales/helpers";

	let {
		content,
		onSave,
		onCancel,
	}: {
		content: string;
		onSave: (content: string) => void;
		onCancel: () => void;
	} = $props();

	let editContent = $state("");

	$effect(() => {
		// content가 변경될 때마다 편집 내용 초기화 (편집 모드 진입 시점)
		editContent = content;
	});
</script>

<div class="lumina-message__edit-area">
	<textarea bind:value={editContent} class="lumina-message__edit-textarea" rows="3"></textarea>
	<div class="lumina-message__edit-actions">
		<button class="lumina-message__edit-btn" onclick={onCancel}>{t("common.cancel")}</button>
		<button class="lumina-message__edit-btn lumina-message__edit-btn--primary" onclick={() => {
			if (window.confirm(t("uiMessages.editConfirm"))) {
				onSave(editContent);
			}
		}}>{t("uiMessages.saveAndSend")}</button>
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
</style>