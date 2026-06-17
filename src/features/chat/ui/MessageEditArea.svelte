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