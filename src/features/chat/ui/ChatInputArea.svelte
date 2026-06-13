<script lang="ts">
	import { tick } from "svelte";
	import { setIcon } from "obsidian";
	import type LuminaPlugin from "../../../main";
	import ContextSelector from "./ContextSelector.svelte";
	import SlashCommandSelector, { type SlashCommand } from "./SlashCommandSelector.svelte";
	import McpQuickPopup from "./McpQuickPopup.svelte";
	import type { ContextAttachment } from "../../../shared/types/chat.types";
	import { processFiles, getAttachmentIcon } from "../utils/fileAttachmentUtils";
	import { detectMention, detectSlashCommand } from "../utils/inputUtils";

	let {
		plugin,
		isLoading,
		hasProvider,
		sendHint,
		sessionTokenStats,
		includeActiveNote,
		tStore,
		inputText = $bindable(""),
		attachments = $bindable<ContextAttachment[]>([]),
		textareaEl = $bindable<HTMLTextAreaElement | null>(null),
		onToggleActiveNote,
		onSendMessage,
		onCancelStream,
		onClearChat,
		onToggleRagMode,
		onOpenSettings,
	} = $props<{
		plugin: LuminaPlugin;
		isLoading: boolean;
		hasProvider: boolean;
		sendHint: string;
		sessionTokenStats: { totalTokens: number; estimatedCost: number };
		includeActiveNote: boolean;
		tStore: any;
		inputText: string;
		attachments: ContextAttachment[];
		textareaEl: HTMLTextAreaElement | null;
		onToggleActiveNote: () => void;
		onSendMessage: () => void;
		onCancelStream: () => void;
		onClearChat: () => void;
		onToggleRagMode: () => void;
		onOpenSettings: () => void;
	}>();

	let showContextSelector = $state(false);
	let contextSearchQuery = $state("");
	let mentionStartIndex = $state(-1);

	let showSlashSelector = $state(false);
	let slashSearchQuery = $state("");
	let slashStartIndex = $state(-1);

	let showMcpPopup = $state(false);
	let fileInputEl: HTMLInputElement | null = $state(null);

	export function resizeTextarea() {
		if (!textareaEl) return;
		textareaEl.style.height = "auto";
		textareaEl.style.height = Math.min(textareaEl.scrollHeight, 160) + "px";
	}

	function handleKeydown(e: KeyboardEvent) {
		if (showSlashSelector && ["Enter", "ArrowUp", "ArrowDown", "Escape"].includes(e.key)) {
			if (e.key === "Enter") e.preventDefault();
			return;
		}

		if (showContextSelector && ["Enter", "ArrowUp", "ArrowDown", "Escape"].includes(e.key)) {
			if (e.key === "Enter") e.preventDefault();
			return;
		}

		const sendKey = plugin.settings.chat.sendKey;

		if (sendKey === "enter" && e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			if (e.isComposing || e.keyCode === 229) {
				setTimeout(() => onSendMessage(), 50);
			} else {
				onSendMessage();
			}
		} else if (sendKey === "ctrl_enter" && e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
			e.preventDefault();
			if (e.isComposing || e.keyCode === 229) {
				setTimeout(() => onSendMessage(), 50);
			} else {
				onSendMessage();
			}
		}
	}

	function handleInput() {
		resizeTextarea();

		if (!textareaEl) return;
		const val = textareaEl.value;
		const cursor = textareaEl.selectionStart;

		const lastAt = val.lastIndexOf("@", cursor - 1);
		const lastSlash = val.lastIndexOf("/", cursor - 1);

		if (lastAt >= lastSlash) {
			const res = detectMention(val, cursor, lastAt);
			if (res.detected) {
				showContextSelector = true;
				showSlashSelector = false;
				contextSearchQuery = res.query;
				mentionStartIndex = res.startIndex;
				return;
			}
		} else {
			const res = detectSlashCommand(val, cursor, lastSlash);
			if (res.detected) {
				showSlashSelector = true;
				showContextSelector = false;
				slashSearchQuery = res.query;
				slashStartIndex = res.startIndex;
				return;
			}
		}
		
		showContextSelector = false;
		showSlashSelector = false;
	}

	function handleContextSelect(attachment: ContextAttachment) {
		if (!attachments.find((a) => a.path === attachment.path && a.type === attachment.type)) {
			attachments = [...attachments, attachment];
		}

		if (mentionStartIndex !== -1 && textareaEl) {
			const val = inputText;
			const before = val.slice(0, mentionStartIndex);
			const after = val.slice(textareaEl.selectionStart);
			inputText = before + after;

			showContextSelector = false;
			mentionStartIndex = -1;

			tick().then(() => textareaEl?.focus());
		}
	}

	const slashCommands = $derived.by(() => {
		const cmds: SlashCommand[] = [
			{ id: "clear", name: $tStore("chat.slashCommands.clear.name"), description: $tStore("chat.slashCommands.clear.desc"), icon: "trash-2", action: () => onClearChat() },
			{ id: "rag", name: $tStore("chat.slashCommands.rag.name"), description: $tStore("chat.slashCommands.rag.desc"), icon: "database", action: () => onToggleRagMode() },
			{ id: "mcp", name: $tStore("chat.slashCommands.mcp.name"), description: $tStore("chat.slashCommands.mcp.desc"), icon: "lumina-server", action: () => { showMcpPopup = true; } },
			{ id: "settings", name: $tStore("chat.slashCommands.settings.name"), description: $tStore("chat.slashCommands.settings.desc"), icon: "settings", action: () => onOpenSettings() }
		];

		const quickActions = plugin.settings.chat.quickActions || [];
		for (const qa of quickActions) {
			const prompt = qa.prompt;
			cmds.push({
				id: qa.id.replace(/^qa-/, ''),
				name: qa.name,
				description: $tStore("chat.slashCommands.quickActionDesc"),
				icon: "message-square",
				get action() {
					return () => {
						const startIdx = slashStartIndex;
						const before = inputText.slice(0, startIdx === -1 ? inputText.length : startIdx);
						const after = inputText.slice(startIdx === -1 ? inputText.length : startIdx);
						inputText = before + prompt + after;
						tick().then(() => resizeTextarea());
					};
				},
			});
		}

		return cmds;
	});

	function handleSlashCommandSelect(cmd: SlashCommand) {
		if (slashStartIndex !== -1 && textareaEl) {
			const val = inputText;
			const before = val.slice(0, slashStartIndex);
			const after = val.slice(textareaEl.selectionStart);
			inputText = before + after;
			
			showSlashSelector = false;
			slashStartIndex = -1;

			tick().then(() => {
				if (textareaEl) textareaEl.focus();
				cmd.action();
			});
		}
	}

	function removeAttachment(index: number) {
		attachments = attachments.filter((_, i) => i !== index);
	}

	function insertContextMention(e: MouseEvent) {
		e.stopPropagation();
		const cursor = textareaEl?.selectionStart ?? inputText.length;
		const prefix = cursor > 0 && !/\s/.test(inputText[cursor - 1]) ? " @" : "@";
		inputText = inputText.slice(0, cursor) + prefix + inputText.slice(cursor);
		const newCursor = cursor + prefix.length;
		tick().then(() => {
			if (textareaEl) {
				textareaEl.focus();
				textareaEl.selectionStart = newCursor;
				textareaEl.selectionEnd = newCursor;
				handleInput();
			}
		});
	}

	function triggerFileInput() {
		if (fileInputEl) fileInputEl.click();
	}

	async function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		if (!target.files || target.files.length === 0) return;
		const newAtts = await processFiles(target.files, attachments, (key, vars) => {
			let text = $tStore(key);
			if (vars) {
				for (const [k, v] of Object.entries(vars)) {
					text = text.replace(`{{${k}}}`, v);
				}
			}
			return text;
		});
		if (newAtts.length > 0) {
			attachments = [...attachments, ...newAtts];
			tick().then(() => resizeTextarea());
		}
		target.value = "";
	}

	async function handleDrop(e: DragEvent) {
		e.preventDefault();
		const files = e.dataTransfer?.files;
		if (files && files.length > 0) {
			const newAtts = await processFiles(files, attachments, (key, vars) => {
				let text = $tStore(key);
				if (vars) {
					for (const [k, v] of Object.entries(vars)) {
						text = text.replace(`{{${k}}}`, v);
					}
				}
				return text;
			});
			if (newAtts.length > 0) {
				attachments = [...attachments, ...newAtts];
				tick().then(() => resizeTextarea());
			}
		}
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
	}

	async function handlePaste(e: ClipboardEvent) {
		const items = e.clipboardData?.items;
		if (!items) return;

		const files: File[] = [];
		for (let i = 0; i < items.length; i++) {
			if (items[i].kind === "file") {
				const file = items[i].getAsFile();
				if (file) {
					const ext = file.type.split("/")[1] || "png";
					let finalFile = file;
					if (file.name === "image.png" || !file.name.includes(".")) {
						finalFile = new File([file], `Pasted_Image_${Date.now()}.${ext}`, { type: file.type });
					}
					files.push(finalFile);
				}
			}
		}

		if (files.length > 0) {
			const newAtts = await processFiles(files, attachments, (key, vars) => {
				let text = $tStore(key);
				if (vars) {
					for (const [k, v] of Object.entries(vars)) {
						text = text.replace(`{{${k}}}`, v);
					}
				}
				return text;
			});
			if (newAtts.length > 0) {
				attachments = [...attachments, ...newAtts];
				tick().then(() => resizeTextarea());
			}
		}
	}

	function icon(node: HTMLElement, iconId: string) {
		setIcon(node, iconId);
		return {
			update(newIconId: string) {
				node.empty();
				setIcon(node, newIconId);
			},
		};
	}
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
	class="lumina-chat__input-area"
	ondrop={handleDrop}
	ondragover={handleDragOver}
>
	<div class="lumina-chat__input-toolbar">
		<div class="lumina-chat__toolbar-group">
			<button class="lumina-chat__toolbar-btn" aria-label={$tStore("chat.addContext")} use:icon={"lumina-at-sign"} onclick={insertContextMention} type="button">Add Context</button>
			<button class="lumina-chat__toolbar-btn" aria-label={$tStore("chat.uploadFile")} use:icon={"paperclip"} onclick={triggerFileInput} type="button"></button>
			<button class="lumina-chat__toolbar-btn" aria-label="MCP Server" use:icon={"lumina-server"} onclick={(e) => { e.stopPropagation(); showMcpPopup = !showMcpPopup; }} type="button"></button>
		</div>

		<input type="file" multiple class="lumina-chat__hidden-file-input" bind:this={fileInputEl} onchange={handleFileSelect} />

		<div class="lumina-chat__toolbar-right">
			{#if sessionTokenStats.totalTokens > 0}
				<span class="lumina-chat__token-stats" title={$tStore("chat.sessionUsage")}>
					{$tStore("chat.sessionTokens", { tokens: sessionTokenStats.totalTokens.toLocaleString() })}
					{#if sessionTokenStats.estimatedCost > 0}
						{$tStore("chat.sessionCost", { cost: sessionTokenStats.estimatedCost.toFixed(4) })}
					{/if}
				</span>
			{/if}
			<span class="lumina-chat__hint-inline">{sendHint}</span>
			<button class="lumina-chat__context-badge" class:is-active={includeActiveNote} aria-label={$tStore("settings.rag.autoIncludeActive.name")} onclick={onToggleActiveNote}>
				<span use:icon={"file-text"}></span>
				<span>{$tStore("settings.chat.currentNote")}</span>
			</button>
		</div>
	</div>

	<div class="lumina-chat__textarea-wrap">
		<div class="lumina-chat__input-container">
			{#if attachments.length > 0}
				<div class="lumina-chat__attachments">
					{#each attachments as att, i}
						<div class="lumina-chat__attachment-chip">
							<span class="lumina-chat__attachment-icon" use:icon={getAttachmentIcon(att.type)}></span>
							<span class="lumina-chat__attachment-name">{att.name}</span>
							<button class="lumina-chat__attachment-remove" onclick={() => removeAttachment(i)} aria-label="Remove" type="button">
								<span use:icon={"x"}></span>
							</button>
						</div>
					{/each}
				</div>
			{/if}

			{#if showContextSelector}
				<ContextSelector {plugin} searchQuery={contextSearchQuery} onSelect={handleContextSelect} onClose={() => (showContextSelector = false)} />
			{/if}

			{#if showSlashSelector}
				<SlashCommandSelector commands={slashCommands} searchQuery={slashSearchQuery} onSelect={handleSlashCommandSelect} onClose={() => (showSlashSelector = false)} />
			{/if}

			{#if showMcpPopup}
				<McpQuickPopup {plugin} onClose={() => (showMcpPopup = false)} onOpenSettings={() => { showMcpPopup = false; onOpenSettings(); }} />
			{/if}

			<div class="lumina-chat__input-row">
				<textarea
					bind:this={textareaEl}
					bind:value={inputText}
					class="lumina-chat__textarea"
					placeholder={hasProvider ? $tStore("errors.chatPlaceholder") : $tStore("errors.llmConnectRequired")}
					disabled={isLoading || !hasProvider}
					rows="1"
					onkeydown={handleKeydown}
					oninput={handleInput}
					onpaste={handlePaste}
				></textarea>

				{#if inputText.length > 0 && !isLoading}
					<button class="lumina-chat__clear-btn" aria-label={$tStore("chat.clearInput")} onclick={() => { inputText = ""; tick().then(() => { resizeTextarea(); textareaEl?.focus(); }); }} type="button" use:icon={"x"}></button>
				{/if}

				{#if isLoading}
					<button class="lumina-chat__send-btn lumina-chat__send-btn--cancel" onclick={onCancelStream} aria-label={$tStore("errors.cancelStreaming")} use:icon={"lumina-square"}></button>
				{:else}
					<button class="lumina-chat__send-btn" class:is-active={inputText.trim().length > 0 || attachments.length > 0} onclick={onSendMessage} disabled={(!inputText.trim() && attachments.length === 0) || !hasProvider} aria-label={$tStore("errors.send")} use:icon={"lumina-send"}></button>
				{/if}
			</div>
		</div>
	</div>
</div>
