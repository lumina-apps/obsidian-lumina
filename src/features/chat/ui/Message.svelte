<script lang="ts">
	import { Component, MarkdownRenderer, setIcon, type App, TFile, Notice, MarkdownView } from "obsidian";
	import { onMount, onDestroy } from "svelte";
	import type { UIChatMessage } from "../../../shared/types/chat.types";
	import { t, getLanguage } from "../../../shared/locales/helpers";

	let {
		message,
		app,
		onEdit,
		onRegenerate,
	}: {
		message: UIChatMessage;
		app: App;
		onEdit?: (id: string, content: string) => void;
		onRegenerate?: (id: string) => void;
	} = $props();

	let isEditing = $state(false);
	let editContent = $state("");

	let rawContent = $derived(message.content || "");
	let thinkContent = $derived.by(() => {
		const matches = Array.from(rawContent.matchAll(/<think>([\s\S]*?)(?:<\/think>|$)/gi));
		if (matches.length > 0) {
			return matches.map(m => m[1].trim()).filter(Boolean).join('\n\n---\n\n');
		}
		return "";
	});
	let displayContent = $derived.by(() => {
		let content = rawContent.replace(/<think>([\s\S]*?)(?:<\/think>|$)/gi, '');
		content = content.replace(/<(lumina_tool_call|tool_code|tool_call)>([\s\S]*?)(?:<\/\1>|$)/gi, '');
		// 로컬 LLM(Qwen, Mistral 등)의 컨텍스트 마스킹 토큰 제거
		content = content.replace(/<\|mask_start\|>[\s\S]*?<\|mask_end\|>/g, '');
		content = content.replace(/<\|mask_start\|>/g, '').replace(/<\|mask_end\|>/g, '');
		return content.trim();
	});
	let isThinking = $derived(
		message.isStreaming && rawContent.toLowerCase().includes('<think>') && !rawContent.toLowerCase().includes('</think>')
	);

	let contentEl: HTMLElement | null = $state(null);
	let thinkEl: HTMLElement | null = $state(null);
	let comp: Component | null = null;
	let thinkComp: Component | null = null;

	let isThinkOpen = $state(false);
	let hasFinishedStreaming = $state(false);

	$effect(() => {
		if (isThinking) {
			isThinkOpen = true;
		}
	});

	$effect(() => {
		if (!message.isStreaming && !hasFinishedStreaming) {
			hasFinishedStreaming = true;
			isThinkOpen = false;
		}
	});

	// 스트리밍 중/완료 후 마크다운 렌더링 (본문)
	$effect(() => {
		if (!contentEl) return;

		const dContent = displayContent;
		const streaming = message.isStreaming;
		const role = message.role;

		if (streaming) {
			if (comp) {
				comp.unload();
				comp = null;
			}
			contentEl.textContent = dContent;
		} else {
			if (role === "assistant" && dContent) {
				comp?.unload();
				comp = new Component();
				comp.load();
				contentEl.empty();
				MarkdownRenderer.render(app, dContent, contentEl, "", comp);
			} else {
				if (comp) {
					comp.unload();
					comp = null;
				}
				contentEl.textContent = dContent;
			}
		}
	});

	// 스트리밍 중/완료 후 마크다운 렌더링 (추론 과정)
	$effect(() => {
		if (!thinkEl) return;

		const tContent = thinkContent;
		const streaming = message.isStreaming;

		if (streaming) {
			if (thinkComp) {
				thinkComp.unload();
				thinkComp = null;
			}
			thinkEl.textContent = tContent;
		} else {
			if (message.role === "assistant" && tContent) {
				thinkComp?.unload();
				thinkComp = new Component();
				thinkComp.load();
				thinkEl.empty();
				MarkdownRenderer.render(app, tContent, thinkEl, "", thinkComp);
			} else {
				if (thinkComp) {
					thinkComp.unload();
					thinkComp = null;
				}
				thinkEl.textContent = tContent;
			}
		}
	});

	onDestroy(() => {
		comp?.unload();
		thinkComp?.unload();
	});

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString(getLanguage(), {
			hour: "2-digit",
			minute: "2-digit",
		});
	}
	function icon(node: HTMLElement, iconId: string) {
		setIcon(node, iconId);
		return {
			update(newIconId: string) {
				node.empty();
				setIcon(node, newIconId);
			}
		};
	}

	function getAttachmentIcon(type: string) {
		switch (type) {
			case 'file': return 'file-text';
			case 'folder': return 'folder';
			case 'active_note': return 'file-edit';
			case 'selection': return 'mouse-pointer-2';
			case 'canvas': return 'layout';
			case 'tag': return 'hash';
			case 'url': return 'globe';
			case 'external_file': return 'paperclip';
			default: return 'file';
		}
	}

	async function openFile(e: MouseEvent | KeyboardEvent, filePath: string) {
		const file = app.vault.getAbstractFileByPath(filePath);
		if (file instanceof TFile) {
			const leaf = app.workspace.getLeaf(e.ctrlKey || e.metaKey || ('button' in e && e.button === 1) ? 'tab' : false);
			await leaf.openFile(file);
		} else {
			new Notice(t("uiMessages.fileNotFound"));
		}
	}

	async function copyContent() {
		await navigator.clipboard.writeText(displayContent);
		new Notice(t("uiMessages.copiedToClipboard"));
	}

	function insertToNote() {
		const activeEditor = app.workspace.activeEditor?.editor;
		if (activeEditor) {
			activeEditor.replaceSelection(displayContent);
			new Notice(t("uiMessages.contentInserted"));
			return;
		}

		let activeView = app.workspace.getActiveViewOfType(MarkdownView);
		if (!activeView) {
			const activeFile = app.workspace.getActiveFile();
			if (activeFile) {
				const leaves = app.workspace.getLeavesOfType("markdown");
				for (const leaf of leaves) {
					const viewCompat = leaf.view as unknown as { file?: { path: string } };
					if (viewCompat.file?.path === activeFile.path) {
						activeView = leaf.view as MarkdownView;
						break;
					}
				}
			}
		}

		if (activeView && activeView.editor) {
			activeView.editor.replaceSelection(displayContent);
			new Notice(t("uiMessages.contentInserted"));
		} else {
			new Notice(t("uiMessages.noActiveMarkdown"));
		}
	}
</script>

<div
	class="lumina-message lumina-message--{message.role}"
	class:is-streaming={message.isStreaming}
>
	<div class="lumina-message__header">
		{#if message.role === "user"}
			<span class="lumina-message__role">👤 You</span>
		{:else}
			<span class="lumina-message__role"
				>✦ Lumina{message.model ? ` · ${message.model}` : ""}</span
			>
		{/if}
		<span class="lumina-message__time">{formatTime(message.timestamp)}</span>
	</div>

	<div class="lumina-message__body">
		{#if isEditing}
			<div class="lumina-message__edit-area">
				<textarea bind:value={editContent} class="lumina-message__edit-textarea" rows="3"></textarea>
				<div class="lumina-message__edit-actions">
					<button class="lumina-message__edit-btn" onclick={() => isEditing = false}>{t("common.cancel")}</button>
					<button class="lumina-message__edit-btn lumina-message__edit-btn--primary" onclick={() => {
						if (window.confirm(t("uiMessages.editConfirm"))) {
							isEditing = false;
							onEdit?.(message.id, editContent);
						}
					}}>{t("uiMessages.saveAndSend")}</button>
				</div>
			</div>
		{:else}
			{#if message.attachments && message.attachments.length > 0}
				<div class="lumina-message__attachments">
					{#each message.attachments as att}
						<div 
							class="lumina-message__attachment-chip" 
							title={att.path}
							onclick={(e) => {
								if (att.type === 'file' || att.type === 'active_note') {
									openFile(e, att.path);
								}
							}}
							onauxclick={(e) => {
								if (att.type === 'file' || att.type === 'active_note') {
									openFile(e, att.path);
								}
							}}
							onkeydown={(e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									if (att.type === 'file' || att.type === 'active_note') {
										openFile(e, att.path);
									}
								}
							}}
							role="button"
							tabindex="0"
						>
							<span class="lumina-message__attachment-icon" use:icon={getAttachmentIcon(att.type)}></span>
							<span class="lumina-message__attachment-name">{att.name}</span>
						</div>
					{/each}
				</div>
			{/if}
			{#if thinkContent}
				<details class="lumina-message__think-block" bind:open={isThinkOpen}>
					<summary class="lumina-message__think-summary">🧠 {t("uiMessages.thoughtProcess")} {isThinking ? '...' : ''}</summary>
					<div class="lumina-message__think-content-wrapper">
						<div class="lumina-message__think-content" bind:this={thinkEl}></div>
						{#if isThinking}
							<span class="lumina-message__cursor">▋</span>
						{/if}
					</div>
				</details>
			{/if}
			<div class="lumina-message__content" bind:this={contentEl}></div>
			{#if message.isStreaming && !isThinking}
				<span class="lumina-message__cursor">▋</span>
			{/if}
		{/if}
	</div>

	{#if !message.isStreaming}
		{#if message.role === "assistant" && message.ragSources && message.ragSources.length > 0}
			<div class="lumina-message__rag-sources">
				{#each message.ragSources as source}
					<button 
						class="lumina-message__rag-source" 
						aria-label={t("uiMessages.openReferenceNote")}
						onclick={(e) => openFile(e, source.filePath)}
						onauxclick={(e) => openFile(e, source.filePath)}
					>
						📄 {source.filePath.split('/').pop()?.replace('.md', '') || source.filePath}
					</button>
				{/each}
			</div>
		{/if}

		<div class="lumina-message__actions">
			{#if message.role === "assistant"}
				<button class="clickable-icon lumina-message__action-btn" aria-label={t("common.copy")} use:icon={"copy"} onclick={copyContent}></button>
				<button class="clickable-icon lumina-message__action-btn" aria-label={t("uiMessages.insertToNote")} use:icon={"arrow-down"} onclick={insertToNote}></button>
				<button class="clickable-icon lumina-message__action-btn" aria-label={t("uiMessages.regenerate")} use:icon={"refresh-cw"} onclick={() => {
					if (window.confirm(t("uiMessages.regenerateConfirm"))) {
						onRegenerate?.(message.id);
					}
				}}></button>
			{:else}
				{#if !isEditing}
					<button class="clickable-icon lumina-message__action-btn" aria-label={t("common.copy")} use:icon={"copy"} onclick={copyContent}></button>
					<button class="clickable-icon lumina-message__action-btn" aria-label={t("uiMessages.insertToNote")} use:icon={"arrow-down"} onclick={insertToNote}></button>
					<button class="clickable-icon lumina-message__action-btn" aria-label={t("uiMessages.edit")} use:icon={"pencil"} onclick={() => {
						isEditing = true;
						editContent = message.content;
					}}></button>
				{/if}
			{/if}
		</div>
	{/if}
</div>

<style>
	.lumina-message {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 12px 14px;
		animation: fadeSlideIn 0.25s cubic-bezier(0.4, 0, 0.2, 1);
		transition: all 0.2s ease;
	}

	@keyframes fadeSlideIn {
		from {
			opacity: 0;
			transform: translateY(8px);
		}
		to {
			opacity: 1;
			transform: translateY(0);
		}
	}

	.lumina-message--user {
		background: var(--background-secondary-alt);
		margin-left: 28px;
		border-radius: 14px 14px 2px 14px;
		border: 1px solid rgba(var(--mono-rgb-100), 0.05);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.015);
	}

	.lumina-message--assistant {
		background: var(--background-secondary);
		margin-right: 28px;
		border-radius: 14px 14px 14px 2px;
		border: 1px solid rgba(var(--mono-rgb-100), 0.04);
		border-left: 3px solid var(--interactive-accent);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.01);
	}

	.lumina-message__header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
		margin-bottom: 2px;
	}

	.lumina-message__role {
		font-size: 10.5px;
		font-weight: 700;
		color: var(--text-muted);
		letter-spacing: 0.04em;
		text-transform: uppercase;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.lumina-message--assistant .lumina-message__role {
		background: linear-gradient(135deg, var(--interactive-accent) 0%, #a855f7 100%);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
	}

	.lumina-message__time {
		font-size: 9.5px;
		color: var(--text-faint);
		font-weight: 500;
	}

	.lumina-message__body {
		position: relative;
	}

	.lumina-message__content {
		font-size: 13px;
		line-height: 1.6;
		color: var(--text-normal);
		word-break: break-word;
	}

	.lumina-message__think-block {
		margin-bottom: 8px;
		background: rgba(var(--mono-rgb-100), 0.03);
		border-radius: 8px;
		border-left: 3px solid var(--text-muted);
		overflow: hidden;
	}

	.lumina-message__think-summary {
		padding: 8px 12px;
		font-size: 11.5px;
		font-weight: 600;
		color: var(--text-muted);
		cursor: pointer;
		user-select: none;
		display: flex;
		align-items: center;
		gap: 6px;
		transition: background 0.2s;
	}

	.lumina-message__think-summary:hover {
		background: rgba(var(--mono-rgb-100), 0.05);
		color: var(--text-normal);
	}

	.lumina-message__think-content-wrapper {
		padding: 0 12px 10px 12px;
	}

	.lumina-message__think-content {
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--text-muted);
	}

	.lumina-message__think-content :global(p) {
		margin: 0 0 6px;
	}

	.lumina-message__think-content :global(p:last-child) {
		margin-bottom: 0;
	}

	/* 사용자 메시지: plaintext 입력이므로 pre-wrap 적용 */
	.lumina-message--user .lumina-message__content {
		white-space: pre-wrap;
	}

	/* 어시스턴트 메시지: MarkdownRenderer가 만드는 요소들 스타일 오버라이드 */
	.lumina-message__content :global(p) {
		margin: 0 0 8px;
		white-space: normal;
	}

	.lumina-message__content :global(p:last-child) {
		margin-bottom: 0;
	}

	.lumina-message__content :global(code) {
		background: var(--code-background);
		padding: 2px 5px;
		border-radius: 4px;
		font-size: 11.5px;
		font-family: var(--font-monospace);
	}

	.lumina-message__content :global(pre) {
		background: var(--code-background);
		padding: 12px 14px;
		border-radius: 8px;
		overflow-x: auto;
		border: 1px solid rgba(var(--mono-rgb-100), 0.05);
		margin: 8px 0;
	}

	.lumina-message__content :global(ul),
	.lumina-message__content :global(ol) {
		padding-left: 20px;
		margin: 6px 0;
	}

	.lumina-message__cursor {
		display: inline-block;
		color: var(--interactive-accent);
		animation: blink 1s step-end infinite;
		font-size: 14px;
		vertical-align: bottom;
		margin-left: 2px;
	}

	@keyframes blink {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0;
		}
	}

	.lumina-message__actions {
		display: flex;
		gap: 6px;
		margin-top: 6px;
		opacity: 1; /* 마우스 오버 없이 항상 보이도록 변경 */
		transition: opacity 0.2s ease;
	}

	.lumina-message__rag-sources {
		display: flex;
		gap: 4px;
		margin-top: 10px;
		flex-wrap: wrap;
	}

	.lumina-message__attachments {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		margin-bottom: 8px;
	}

	.lumina-message__attachment-chip {
		display: flex;
		align-items: center;
		gap: 4px;
		padding: 3px 8px;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		font-size: 11px;
		color: var(--text-muted);
		max-width: 200px;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.lumina-message__attachment-chip:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
		border-color: rgba(139, 92, 246, 0.3);
	}

	.lumina-message__attachment-icon {
		display: flex;
		align-items: center;
	}

	.lumina-message__attachment-icon :global(svg) {
		width: 12px !important;
		height: 12px !important;
		opacity: 0.8;
	}

	.lumina-message__attachment-name {
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.lumina-message__rag-source {
		font-size: 9.5px;
		padding: 3px 6px;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.lumina-message__rag-source:hover {
		background: var(--background-modifier-hover);
		color: var(--interactive-accent);
		border-color: rgba(139, 92, 246, 0.3);
	}

	.lumina-message:hover .lumina-message__actions {
		opacity: 1;
	}

	.lumina-message--user .lumina-message__actions {
		justify-content: flex-end;
	}

	.lumina-message__action-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		border-radius: 6px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.lumina-message__action-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
		border-color: var(--background-modifier-border);
	}

	/* Svelte 스코프 문제 및 Obsidian 전역 스타일 충돌을 방지하기 위해 :global 사용 */
	.lumina-message__action-btn :global(svg) {
		width: 14px !important;
		height: 14px !important;
		stroke-width: 2px !important;
		stroke: currentColor !important;
		fill: none !important;
		display: inline-block !important;
		opacity: 1 !important;
		visibility: visible !important;
	}
	
	.lumina-message__action-btn :global(path),
	.lumina-message__action-btn :global(rect),
	.lumina-message__action-btn :global(polyline),
	.lumina-message__action-btn :global(line) {
		stroke: currentColor !important;
	}

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
