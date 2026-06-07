<script lang="ts">
	import { onMount, tick } from "svelte";
	import { setIcon, Notice } from "obsidian";
	import type LuminaPlugin from "../../../main";
	import { ChatController } from "../chatController";
	import Message from "./Message.svelte";
	import ChatHistoryList from "./ChatHistoryList.svelte";
	import ModelSelector from "./ModelSelector.svelte";
	import ContextSelector from "./ContextSelector.svelte";
	import QuickSettings from "./QuickSettings.svelte";
	import McpQuickPopup from "./McpQuickPopup.svelte";
	import SlashCommandSelector, { type SlashCommand } from "./SlashCommandSelector.svelte";
	import type { ContextAttachment } from "../../../shared/types/chat.types";
	// ── stores ──────────────────────────────────────────────────────────────
	import {
		messages,
		isLoading,
		resetChat,
		pendingAttachments,
	} from "../../../core/store/chatStore";
	import {
		indexingState,
		indexingProgress,
		estimatedTimeRemaining,
		setIndexingStatus,
		showIndexingIndicator,
	} from "../../../core/store/ragStore";
	import {
		verifiedProviders,
		isRagEnabled,
		settingsStore,
	} from "../../../core/store/settingsStore";
	import { PROVIDER_LABELS } from "../../../shared/types/settings.types";
	import { t, tStore } from "../../../shared/locales/index";

	let { plugin }: { plugin: LuminaPlugin } = $props();

	// ── 로컬 상태 (UI 전용) ──────────────────────────────────────────────────
	let inputText = $state("");
	let selectedProviderId = $state("");
	let selectedModelId = $state("");
	let abortController: AbortController | null = null;
	let showHistory = $state(false);
	let showQuickSettings = $state(false);

	let attachments = $state<ContextAttachment[]>([]);
	let showContextSelector = $state(false);
	let showMcpPopup = $state(false);
	let contextSearchQuery = $state("");
	let mentionStartIndex = $state(-1);

	let showSlashSelector = $state(false);
	let slashSearchQuery = $state("");
	let slashStartIndex = $state(-1);

	// DOM refs (Svelte 5: bind:this 대상은 $state로 선언)
	let messagesEl: HTMLElement | null = $state(null);
	let textareaEl: HTMLTextAreaElement | null = $state(null);
	let fileInputEl: HTMLInputElement | null = $state(null);

	// 스크롤 디바운스 타이머
	let scrollTimer: ReturnType<typeof setTimeout> | null = null;
	let isUserScrolledUp = $state(false);
	let lastScrollTop = 0;

	function handleMessagesScroll() {
		if (!messagesEl) return;
		const { scrollTop, scrollHeight, clientHeight } = messagesEl;
		
		// 사용자가 실제로 위로 스크롤했는지 확인 (scrollTop이 이전보다 작아졌고, 하단에서 40px 이상 떨어져 있는 경우)
		if (scrollTop < lastScrollTop && scrollHeight - scrollTop - clientHeight > 40) {
			isUserScrolledUp = true;
		} else if (scrollHeight - scrollTop - clientHeight <= 40) {
			// 다시 하단에 도달하면 스크롤업 상태 해제
			isUserScrolledUp = false;
		}
		
		lastScrollTop = scrollTop;
	}

	// 컨트롤러 (onMount에서 초기화)
	let ctrl: ChatController | null = $state(null);

	// ── 계산된 값 (store + 로컬 state 조합) ──────────────────────────────────
	// settingsStore의 verifiedProviders 구독
	const hasProvider = $derived($verifiedProviders.length > 0);

	const modelOptions = $derived(
		$verifiedProviders.flatMap((p) =>
			p.availableModels.map((m) => {
				const shortLabel = PROVIDER_LABELS[p.type].replace(/\s*\(.*\)\s*/, "");
				return {
					label: `[${shortLabel}] ${m}`,
					value: `${p.id}::${m}`,
				};
			}),
		),
	);

	const sendHint = $derived(
		($settingsStore?.chat.sendKey ?? plugin.settings.chat.sendKey) === "enter"
			? $tStore("settings.chat.sendMode.enter")
			: $tStore("settings.chat.sendMode.ctrlEnter"),
	);

	const sessionTokenStats = $derived.by(() => {
		let totalTokens = 0;
		let estimatedCost = 0;
		for (const msg of $messages) {
			if (msg.tokenUsage) {
				totalTokens += msg.tokenUsage.totalTokens;
				if (msg.tokenUsage.estimatedCost) {
					estimatedCost += msg.tokenUsage.estimatedCost;
				}
			}
		}
		return { totalTokens, estimatedCost };
	});

	// ── 전송 핸들러 ───────────────────────────────────────────────────────────
	async function sendMessage() {
		const text = inputText.trim();
		if (!text || $isLoading || !hasProvider || !ctrl) return;

		const currentAttachments = [...attachments];
		inputText = "";
		attachments = [];
		resizeTextarea();

		abortController = new AbortController();
		let wasCancelled = false;

		try {
			// controller가 store를 직접 업데이트 (메시지 추가 / 스트리밍 / 완료)
			await ctrl.sendMessage(
				text,
				currentAttachments,
				selectedProviderId,
				selectedModelId,
				{ useRagContext, includeActiveNote },
				abortController.signal,
			);
		} catch (err) {
			if (err instanceof Error && err.name === "AbortError") {
				// 사용자가 직접 취소한 경우 — 미완성 응답은 저장하지 않음
				wasCancelled = true;
			}
			// AbortError 포함 모든 에러는 store에 이미 반영됨, 여기선 무시
		} finally {
			abortController = null;
			if (!wasCancelled) {
				await ctrl.saveHistory(selectedProviderId, selectedModelId);
			}
		}

		isUserScrolledUp = false;
		await tick();
		scrollToBottom("smooth");
	}

	async function handleEditMessage(messageId: string, newContent: string) {
		if ($isLoading || !hasProvider || !ctrl) return;

		abortController = new AbortController();
		let wasCancelled = false;

		try {
			await ctrl.editMessageAndResend(
				messageId,
				newContent,
				selectedProviderId,
				selectedModelId,
				{ useRagContext, includeActiveNote },
				abortController.signal,
			);
		} catch (err) {
			if (err instanceof Error && err.name === "AbortError") {
				wasCancelled = true;
			}
		} finally {
			abortController = null;
			if (!wasCancelled) {
				await ctrl.saveHistory(selectedProviderId, selectedModelId);
			}
		}

		isUserScrolledUp = false;
		await tick();
		scrollToBottom("smooth");
	}

	async function handleRegenerate(assistantMessageId: string) {
		if ($isLoading || !hasProvider || !ctrl) return;

		const msgs = $messages;
		const targetIndex = msgs.findIndex((m) => m.id === assistantMessageId);
		if (targetIndex === -1) return;

		// Find the last user message before this assistant message
		let userMsgIndex = -1;
		for (let i = targetIndex - 1; i >= 0; i--) {
			if (msgs[i].role === "user") {
				userMsgIndex = i;
				break;
			}
		}

		if (userMsgIndex === -1) return;

		const userMsg = msgs[userMsgIndex];
		await handleEditMessage(userMsg.id, userMsg.content);
	}

	function cancelStream() {
		abortController?.abort();
		abortController = null;
	}

	function clearChat() {
		if ($isLoading) cancelStream();
		
			// 디폴트 모델로 재설정 (디폴트가 설정되지 않은 경우 현재 선택된 모델 유지)
		if (plugin.settings.connections.defaultProviderId) {
			selectedProviderId = plugin.settings.connections.defaultProviderId;
			selectedModelId = plugin.settings.connections.defaultModelId;
		}
		
		resetChat();
	}

	let includeActiveNote = $state(false);
	let useRagContext = $state(false);

	// 전역 설정이 꺼지면 로컬 토글도 강제로 끔
	$effect(() => {
		if (!$isRagEnabled) {
			useRagContext = false;
		}
	});

	async function toggleActiveNote() {
		includeActiveNote = !includeActiveNote;
	}

	async function toggleRagMode() {
		if (!$isRagEnabled) {
			new Notice(
				$tStore("errors.ragDisabledGlobally") ||
					"Global RAG engine is disabled. Turn it on in Settings.",
			);
			return;
		}
		useRagContext = !useRagContext;
	}

	// ── 입력 핸들러 ───────────────────────────────────────────────────────────
	function handleKeydown(e: KeyboardEvent) {
		if (
			showSlashSelector &&
			(e.key === "Enter" ||
				e.key === "ArrowUp" ||
				e.key === "ArrowDown" ||
				e.key === "Escape")
		) {
			if (e.key === "Enter") e.preventDefault();
			return;
		}

		if (
			showContextSelector &&
			(e.key === "Enter" ||
				e.key === "ArrowUp" ||
				e.key === "ArrowDown" ||
				e.key === "Escape")
		) {
			if (e.key === "Enter") e.preventDefault();
			return;
		}

		const sendKey =
			$settingsStore?.chat.sendKey ?? plugin.settings.chat.sendKey;

		if (sendKey === "enter" && e.key === "Enter" && !e.shiftKey) {
			e.preventDefault();
			if (e.isComposing || e.keyCode === 229) {
				setTimeout(() => sendMessage(), 50);
			} else {
				sendMessage();
			}
		} else if (
			sendKey === "ctrl_enter" &&
			e.key === "Enter" &&
			(e.ctrlKey || e.metaKey)
		) {
			e.preventDefault();
			if (e.isComposing || e.keyCode === 229) {
				setTimeout(() => sendMessage(), 50);
			} else {
				sendMessage();
			}
		}
	}

	/**
	 * `providerId::modelId` 형식의 값을 안전하게 분리합니다.
	 * 모델 ID 자체에 '::'가 포함되어도 첫 번째 '::' 기준으로만 분리합니다.
	 */
	function splitProviderModel(val: string): [string, string] {
		const idx = val.indexOf("::");
		if (idx === -1) return [val, ""];
		return [val.slice(0, idx), val.slice(idx + 2)];
	}

	function handleInput() {
		resizeTextarea();

		if (!textareaEl) return;
		const val = textareaEl.value;
		const cursor = textareaEl.selectionStart;

		const lastAt = val.lastIndexOf("@", cursor - 1);
		const lastSlash = val.lastIndexOf("/", cursor - 1);

		if (lastAt !== -1 && lastAt >= lastSlash) {
			if (lastAt === 0 || /\s/.test(val[lastAt - 1])) {
				const query = val.slice(lastAt + 1, cursor);
				if (!/\s/.test(query)) {
					showContextSelector = true;
					showSlashSelector = false;
					contextSearchQuery = query;
					mentionStartIndex = lastAt;
					return;
				}
			}
		} else if (lastSlash !== -1 && lastSlash >= lastAt) {
			if (lastSlash === 0 || /\s/.test(val[lastSlash - 1]) || val[lastSlash - 1] === "\n") {
				const query = val.slice(lastSlash + 1, cursor);
				if (!/\s/.test(query)) {
					showSlashSelector = true;
					showContextSelector = false;
					slashSearchQuery = query;
					slashStartIndex = lastSlash;
					return;
				}
			}
		}
		
		showContextSelector = false;
		showSlashSelector = false;
	}

	function handleContextSelect(attachment: ContextAttachment) {
		if (
			!attachments.find(
				(a) => a.path === attachment.path && a.type === attachment.type,
			)
		) {
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

	const slashCommands = $derived.by(() => {
		const cmds: SlashCommand[] = [
			{
				id: "clear",
				name: $tStore("chat.slashCommands.clear.name"),
				description: $tStore("chat.slashCommands.clear.desc"),
				icon: "trash-2",
				action: () => clearChat()
			},
			{
				id: "rag",
				name: $tStore("chat.slashCommands.rag.name"),
				description: $tStore("chat.slashCommands.rag.desc"),
				icon: "database",
				action: () => toggleRagMode()
			},
			{
				id: "mcp",
				name: $tStore("chat.slashCommands.mcp.name"),
				description: $tStore("chat.slashCommands.mcp.desc"),
				icon: "lumina-server",
				action: () => { showMcpPopup = true; }
			},
			{
				id: "settings",
				name: $tStore("chat.slashCommands.settings.name"),
				description: $tStore("chat.slashCommands.settings.desc"),
				icon: "settings",
				action: () => openSettingsToTab()
			}
		];

		const quickActions = plugin.settings.chat.quickActions || [];
		quickActions.forEach(qa => {
			cmds.push({
				id: qa.id.replace(/^qa-/, ''),
				name: qa.name,
				description: $tStore("chat.slashCommands.quickActionDesc"),
				icon: "message-square",
				action: () => {
					// slash 문자가 제거된 위치(기존 커서 위치)에 프롬프트 삽입
					const before = inputText.slice(0, slashStartIndex === -1 ? inputText.length : slashStartIndex);
					const after = inputText.slice(slashStartIndex === -1 ? inputText.length : slashStartIndex);
					inputText = before + qa.prompt + after;
					tick().then(() => resizeTextarea());
				}
			});
		});

		return cmds;
	});

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
		if (fileInputEl) {
			fileInputEl.click();
		}
	}

	async function processFiles(files: FileList | File[] | DataTransferItemList) {
		for (let i = 0; i < files.length; i++) {
			let file: File | null = null;

			if (files[i] instanceof File) {
				file = files[i] as File;
			} else if ("getAsFile" in files[i]) {
				const item = files[i] as DataTransferItem;
				if (item.kind === "file") {
					file = item.getAsFile();
				}
			}

			if (!file) continue;

			const ext = file.name.split(".").pop()?.toLowerCase() || "";

			// 이미 존재하는지 확인
			if (
				attachments.find(
					(a) => a.name === file?.name && a.type === "external_file",
				)
			) {
				continue;
			}

			try {
				let content = "";

				// 이미지 파일
				if (["png", "jpg", "jpeg", "webp", "gif"].includes(ext)) {
					content = await new Promise((resolve) => {
						const reader = new FileReader();
						reader.onload = () => resolve(reader.result as string);
						reader.readAsDataURL(file!);
					});
				}
				// 텍스트 파일
				else if (
					["md", "txt", "csv", "json", "jsonl", "html", "htm"].includes(ext)
				) {
					content = await file.text();
				}
				// 바이너리 문서
				else if (["pdf", "docx", "xlsx", "xls"].includes(ext)) {
					const buffer = await file.arrayBuffer();
					const { DocumentParserRouter } = await import(
						"../../rag/parsers/DocumentParserRouter"
					);
					content = await DocumentParserRouter.parseBuffer(buffer, ext);
				} else {
					new Notice(t('uiMessages.unsupportedFileType', { ext }));
					continue;
				}

				attachments = [
					...attachments,
					{
						type: "external_file",
						path: "",
						name: file.name,
						content: content,
					},
				];
			} catch (error) {
				console.error("파일 첨부 실패:", error);
				new Notice(t('uiMessages.attachFileFailed', { file: file.name }));
			}
		}

		tick().then(() => resizeTextarea());
	}

	async function handleFileSelect(e: Event) {
		const target = e.target as HTMLInputElement;
		if (!target.files || target.files.length === 0) return;
		await processFiles(target.files);
		target.value = "";
	}

	async function handleDrop(e: DragEvent) {
		e.preventDefault();
		const files = e.dataTransfer?.files;
		if (files && files.length > 0) {
			await processFiles(files);
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
					// Some browsers assign generic names like "image.png" on paste
					const ext = file.type.split("/")[1] || "png";
					let finalFile = file;
					if (file.name === "image.png" || !file.name.includes(".")) {
						finalFile = new File([file], `Pasted_Image_${Date.now()}.${ext}`, {
							type: file.type,
						});
					}
					files.push(finalFile);
				}
			}
		}

		if (files.length > 0) {
			await processFiles(files);
		}
	}

	function getAttachmentIcon(type: string) {
		switch (type) {
			case "file":
				return "file-text";
			case "folder":
				return "folder";
			case "active_note":
				return "file-edit";
			case "selection":
				return "mouse-pointer-2";
			case "canvas":
				return "layout";
			case "tag":
				return "hash";
			case "url":
				return "globe";
			case "external_file":
				return "paperclip";
			default:
				return "file";
		}
	}

	function resizeTextarea() {
		if (!textareaEl) return;
		textareaEl.style.height = "auto";
		textareaEl.style.height = Math.min(textareaEl.scrollHeight, 160) + "px";
	}

	function scrollToBottom(behavior: ScrollBehavior = "smooth") {
		tick().then(() => {
			messagesEl?.scrollTo({
				top: messagesEl.scrollHeight,
				behavior,
			});
		});
	}

	// messages가 업데이트될 때 스크롤 (스로틀링 적용)
	$effect(() => {
		const msgs = $messages;
		if (msgs.length > 0) {
			// 마지막 메시지의 내용이나 스트리밍 상태가 변할 때도 반응하도록 명시적으로 종속성 추가
			const lastMsg = msgs[msgs.length - 1];
			const _trigger = lastMsg.content + lastMsg.isStreaming;

			if (!scrollTimer) {
				scrollTimer = setTimeout(() => {
					scrollTimer = null;
					if (!isUserScrolledUp) {
						// 스트리밍 중에는 auto로 해야 덜 버벅이고 자연스러움
						scrollToBottom("auto");
					}
				}, 50);
			}
		}
	});

	onMount(() => {
		selectedProviderId = plugin.settings.connections.defaultProviderId;
		selectedModelId = plugin.settings.connections.defaultModelId;

		// 기본 모델 미설정 시 첫 번째 검증된 모델로 폴백
		if (!selectedProviderId && modelOptions.length > 0) {
			const [pid, mid] = splitProviderModel(modelOptions[0].value);
			selectedProviderId = pid;
			selectedModelId = mid;
		}

		// 초기 로컬 상태 세팅
		includeActiveNote = plugin.settings.rag.includeActiveNote;
		useRagContext = plugin.settings.connections.ragEnabled;

		ctrl = new ChatController(plugin);
		textareaEl?.focus();

		// 외부에서 추가된 pendingAttachments 구독 (예: 우클릭 메뉴를 통한 텍스트 추가)
		const unsubPending = pendingAttachments.subscribe((atts) => {
			if (atts.length > 0) {
				const newAtts = atts.filter(
					(pa) =>
						!attachments.some((a) => {
							if (a.type !== pa.type) return false;
							if (pa.path) return a.path === pa.path;
							if (pa.content) return a.content === pa.content;
							return a.name === pa.name;
						}),
				);
				if (newAtts.length > 0) {
					attachments = [...attachments, ...newAtts];
					tick().then(() => {
						resizeTextarea();
						textareaEl?.focus();
					});
				}
				// 큐 비우기 (타이머를 통해 현재 이벤트 루프 이후에 처리하여 무한 루프 방지)
				setTimeout(() => {
					pendingAttachments.set([]);
				}, 0);
			}
		});

		return () => {
			unsubPending();
		};
	});

	function showUnderDevelopmentNotice() {
		new Notice($tStore("errors.underDevelopment"));
	}

	function openSettingsToTab(tabId: string = "obsidian-lumina") {
		// @ts-ignore
		(plugin.app as any).setting.open();
		// @ts-ignore
		(plugin.app as any).setting.openTabById(tabId);
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

<div class="lumina-chat">
	<!-- Header -->
	<div class="lumina-chat__header">
		<div class="lumina-chat__title">
			<span class="lumina-chat__logo">✦</span>
			<span>Lumina</span>
		</div>

		<div class="lumina-chat__controls">
			<!-- RAG 상태 배지 -->
			{#if $isRagEnabled}
				{#if $indexingState.status === "ready"}
					<span
						class="lumina-chat__rag-badge lumina-chat__rag-badge--ready"
						title={$tStore("settings.rag.status.ready")}>RAG ✓</span
					>
				{:else if $indexingState.status === "indexing" || $indexingState.status === "loading-model"}
					<span
						class="lumina-chat__rag-badge lumina-chat__rag-badge--indexing"
						title={$tStore("settings.rag.status.indexingShort")}
					>
						{#if $indexingState.status === "loading-model"}
							RAG …
						{:else}
							RAG {$indexingProgress}%
							{#if $estimatedTimeRemaining !== null}
								({$estimatedTimeRemaining < 60
									? ($tStore("settings.rag.init.remainingTimeSec") || "").replace("{{sec}}", $estimatedTimeRemaining.toString())
									: ($tStore("settings.rag.init.remainingTimeMinSec") || "")
											.replace("{{min}}", Math.floor($estimatedTimeRemaining / 60).toString())
											.replace("{{sec}}", ($estimatedTimeRemaining % 60).toString())})
							{/if}
						{/if}
					</span>
				{:else}
					<span
						class="lumina-chat__rag-badge lumina-chat__rag-badge--idle"
						title={$indexingState.status === "error" ? $tStore("settings.rag.status.error") : $tStore("settings.rag.status.waiting")}
					>
						RAG -
					</span>
				{/if}
			{/if}

			<!-- 일반/RAG 토글 -->
			<button
				class="lumina-chat__toggle-btn"
				class:is-active={useRagContext}
				class:is-disabled={!$isRagEnabled}
				aria-label={$tStore("settings.rag.toggleTooltip")}
				onclick={toggleRagMode}
			>
				RAG
			</button>

			{#if $verifiedProviders.length > 0}
				<ModelSelector
					providers={$verifiedProviders}
					bind:selectedProviderId
					bind:selectedModelId
				/>
			{/if}

			<!-- 새 채팅 -->
			<button
				class="clickable-icon lumina-chat__icon-btn"
				aria-label={$tStore("chat.newChat")}
				onclick={clearChat}
				type="button"
				use:icon={"lumina-message-plus"}
			>
			</button>

			<!-- 히스토리 (대화 기록) -->
			<button
				class="clickable-icon lumina-chat__icon-btn"
				class:is-active={showHistory}
				aria-label={$tStore("chat.history")}
				onclick={() => (showHistory = !showHistory)}
				type="button"
				use:icon={"history"}
			>
			</button>

			<!-- 채팅 설정 -->
			<button
				class="clickable-icon lumina-chat__icon-btn"
				class:is-active={showQuickSettings}
				aria-label={$tStore("chat.settings")}
				type="button"
				onclick={(e) => {
					e.stopPropagation();
					showQuickSettings = !showQuickSettings;
				}}
				use:icon={"settings"}
			>
			</button>
		</div>

		<QuickSettings {plugin} bind:isOpen={showQuickSettings} />
	</div>

	{#if showHistory}
		<div class="lumina-chat__history-wrap">
			{#if ctrl}
				<ChatHistoryList
					{ctrl}
					onSessionSelect={() => (showHistory = false)}
					onBack={() => (showHistory = false)}
				/>
			{/if}
		</div>
	{:else}
		<!-- RAG Progress Banner Fixed -->
		{#if $isRagEnabled && $showIndexingIndicator}
			<div class="lumina-chat__rag-banner">
				<div class="lumina-chat__rag-banner-content">
					{#if $indexingState.status === "loading-model"}
						<strong
							>{$tStore("settings.rag.init.loadingModel") ||
								$tStore("settings.rag.init.downloading")}</strong
						>
						<span>{$tStore("settings.rag.init.loadingModelDesc") || ""}</span>
					{:else}
						<strong
							>{$tStore("settings.rag.init.indexingVault") ||
								$tStore("settings.rag.init.indexingNotes")}</strong
						>
						<span
							>{($tStore("settings.rag.init.indexingProgressText") || "")
								.replace("{{processed}}", $indexingState.processedFiles.toString())
								.replace("{{total}}", $indexingState.totalFiles.toString())
								.replace("{{pct}}", $indexingProgress.toString())}
							{#if $estimatedTimeRemaining !== null}
								{$tStore("settings.rag.init.remainingTimePrefix") || ""}{$estimatedTimeRemaining < 60
									? ($tStore("settings.rag.init.remainingTimeSec") || "").replace("{{sec}}", $estimatedTimeRemaining.toString())
									: ($tStore("settings.rag.init.remainingTimeMinSec") || "")
											.replace("{{min}}", Math.floor($estimatedTimeRemaining / 60).toString())
											.replace("{{sec}}", ($estimatedTimeRemaining % 60).toString())}
							{/if}
						</span>
					{/if}
				</div>
			</div>
		{/if}

		<!-- Messages -->
		<div
			class="lumina-chat__messages"
			bind:this={messagesEl}
			onscroll={handleMessagesScroll}
		>

			{#if $messages.length === 0}
				<div class="lumina-chat__empty">
					{#if !hasProvider}
						<div class="lumina-chat__empty-icon">⚙️</div>
						<p>{$tStore("errors.llmNotConnected")}</p>
						<p class="lumina-chat__empty-sub">
							{$tStore("errors.llmConnectRequired")}
						</p>
						<button
							class="lumina-chat__setup-btn"
							type="button"
							onclick={() => openSettingsToTab()}
						>
							⚙️ {$tStore("settings.connections.title")}
						</button>
					{:else}
						<div class="lumina-chat__empty-icon">✦</div>
						<p>{$tStore("errors.chatEmptyWelcome")}</p>
						<p class="lumina-chat__empty-sub">{sendHint}</p>
					{/if}
				</div>
			{:else}
				<div class="lumina-chat__messages-inner">
					{#each $messages as msg (msg.id)}
						<Message
							message={msg}
							app={plugin.app}
							onEdit={handleEditMessage}
							onRegenerate={handleRegenerate}
						/>
					{/each}
				</div>
			{/if}
		</div>

		<!-- Input -->
		<!-- svelte-ignore a11y_no_static_element_interactions -->
		<div
			class="lumina-chat__input-area"
			ondrop={handleDrop}
			ondragover={handleDragOver}
		>
			<div class="lumina-chat__input-toolbar">
				<div class="lumina-chat__toolbar-group">
					<button
						class="lumina-chat__toolbar-btn"
						aria-label={$tStore("chat.addContext")}
						use:icon={"lumina-at-sign"}
						onclick={insertContextMention}
						type="button"
					>
						Add Context
					</button>
					<button
						class="lumina-chat__toolbar-btn"
						aria-label={$tStore("chat.uploadFile")}
						use:icon={"paperclip"}
						onclick={triggerFileInput}
						type="button"
					></button>
					<button
						class="lumina-chat__toolbar-btn"
						aria-label="MCP Server"
						use:icon={"lumina-server"}
						onclick={(e) => {
							e.stopPropagation();
							showMcpPopup = !showMcpPopup;
						}}
						type="button"
					></button>
				</div>

				<input
					type="file"
					multiple
					class="lumina-chat__hidden-file-input"
					style="display: none;"
					bind:this={fileInputEl}
					onchange={handleFileSelect}
				/>

				<div style="display: flex; align-items: center; gap: 8px;">
					{#if sessionTokenStats.totalTokens > 0}
						<span
							class="lumina-chat__token-stats"
							title={$tStore("chat.sessionUsage")}
						>
							{$tStore("chat.sessionTokens", { tokens: sessionTokenStats.totalTokens.toLocaleString() })}
							{#if sessionTokenStats.estimatedCost > 0}
								{$tStore("chat.sessionCost", { cost: sessionTokenStats.estimatedCost.toFixed(4) })}
							{/if}
						</span>
					{/if}
					<span class="lumina-chat__hint-inline">{sendHint}</span>
					<button
						class="lumina-chat__context-badge"
						class:is-active={includeActiveNote}
						aria-label={$tStore("settings.rag.autoIncludeActive.name")}
						onclick={toggleActiveNote}
					>
						<span use:icon={"file-text"}></span>
						<span>{$tStore("settings.chat.currentNote")}</span>
					</button>
				</div>
			</div>

			<div class="lumina-chat__textarea-wrap">
				<div
					class="lumina-chat__input-container"
					style="position: relative; width: 100%; display: flex; flex-direction: column; gap: 8px;"
				>
					{#if attachments.length > 0}
						<div class="lumina-chat__attachments">
							{#each attachments as att, i}
								<div class="lumina-chat__attachment-chip">
									<span
										class="lumina-chat__attachment-icon"
										use:icon={getAttachmentIcon(att.type)}
									></span>
									<span class="lumina-chat__attachment-name">{att.name}</span>
									<button
										class="lumina-chat__attachment-remove"
										onclick={() => removeAttachment(i)}
										aria-label="Remove"
										type="button"
									>
										<span use:icon={"x"}></span>
									</button>
								</div>
							{/each}
						</div>
					{/if}

					{#if showContextSelector}
						<ContextSelector
							{plugin}
							searchQuery={contextSearchQuery}
							onSelect={handleContextSelect}
							onClose={() => (showContextSelector = false)}
						/>
					{/if}

					{#if showSlashSelector}
						<SlashCommandSelector
							commands={slashCommands}
							searchQuery={slashSearchQuery}
							onSelect={handleSlashCommandSelect}
							onClose={() => (showSlashSelector = false)}
						/>
					{/if}

					{#if showMcpPopup}
						<McpQuickPopup
							{plugin}
							onClose={() => (showMcpPopup = false)}
							onOpenSettings={() => {
								showMcpPopup = false;
								openSettingsToTab();
							}}
						/>
					{/if}

					<div
						class="lumina-chat__input-row"
						style="display: flex; gap: 8px; align-items: flex-end;"
					>
						<textarea
							bind:this={textareaEl}
							bind:value={inputText}
							class="lumina-chat__textarea"
							placeholder={hasProvider
								? $tStore("errors.chatPlaceholder")
								: $tStore("errors.llmConnectRequired")}
							disabled={$isLoading || !hasProvider}
							rows="1"
							onkeydown={handleKeydown}
							oninput={handleInput}
							onpaste={handlePaste}
						></textarea>

						{#if inputText.length > 0 && !$isLoading}
							<button
								class="lumina-chat__clear-btn"
								aria-label={$tStore("chat.clearInput")}
								onclick={() => {
									inputText = "";
									tick().then(() => {
										resizeTextarea();
										textareaEl?.focus();
									});
								}}
								type="button"
								use:icon={"x"}
							></button>
						{/if}

						{#if $isLoading}
							<button
								class="lumina-chat__send-btn lumina-chat__send-btn--cancel"
								onclick={cancelStream}
								aria-label={$tStore("errors.cancelStreaming")}
								use:icon={"lumina-square"}
							>
							</button>
						{:else}
							<button
								class="lumina-chat__send-btn"
								class:is-active={inputText.trim().length > 0 ||
									attachments.length > 0}
								onclick={sendMessage}
								disabled={(!inputText.trim() && attachments.length === 0) ||
									!hasProvider}
								aria-label={$tStore("errors.send")}
								use:icon={"lumina-send"}
							>
							</button>
						{/if}
					</div>
				</div>
			</div>
		</div>
	{/if}
</div>

<style>
	.lumina-chat {
		display: flex;
		flex-direction: column;
		height: 100%;
		background: var(--background-primary);
		font-family: var(--font-interface);
	}

	/* ── Header ── */
	.lumina-chat__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 12px 8px 6px;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		box-shadow: 0 2px 8px rgba(0, 0, 0, 0.02);
		flex-shrink: 0;
		position: relative;
	}

	.lumina-chat__title {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 14px;
		font-weight: 700;
		color: var(--text-normal);
	}

	.lumina-chat__logo {
		font-size: 16px;
		background: linear-gradient(
			135deg,
			var(--interactive-accent) 0%,
			#a855f7 100%
		);
		-webkit-background-clip: text;
		-webkit-text-fill-color: transparent;
		filter: drop-shadow(0 2px 6px rgba(168, 85, 247, 0.25));
	}

	.lumina-chat__controls {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.lumina-chat__icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		border-radius: 6px;
		border: none;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.lumina-chat__icon-btn:hover:not(:disabled) {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.lumina-chat__icon-btn:disabled {
		opacity: 0.25;
		cursor: default;
		pointer-events: none;
	}

	.lumina-chat__toggle-btn {
		font-size: 10px;
		font-weight: 700;
		padding: 0 6px;
		height: 22px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		border: 1px solid var(--background-modifier-border);
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		transition: all 0.2s ease;
	}
	.lumina-chat__toggle-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}
	.lumina-chat__toggle-btn.is-active {
		background: var(--interactive-accent);
		color: white;
		border-color: var(--interactive-accent);
	}
	.lumina-chat__toggle-btn.is-disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.lumina-chat__history-wrap {
		flex: 1;
		overflow: hidden;
		display: flex;
		flex-direction: column;
	}

	/* ── Messages ── */
	.lumina-chat__messages {
		flex: 1;
		overflow-y: auto;
		padding: 8px;
		scroll-behavior: smooth;
	}

	/* Custom Scrollbar for Messages Panel */
	.lumina-chat__messages::-webkit-scrollbar {
		width: 6px;
	}

	.lumina-chat__messages::-webkit-scrollbar-thumb {
		background: var(--background-modifier-border);
		border-radius: 3px;
		transition: background 0.25s;
	}

	.lumina-chat__messages::-webkit-scrollbar-thumb:hover {
		background: var(--background-modifier-border-hover);
	}

	.lumina-chat__messages::-webkit-scrollbar-track {
		background: transparent;
	}

	.lumina-chat__messages-inner {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.lumina-chat__empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		height: 100%;
		min-height: 220px;
		gap: 10px;
		color: var(--text-muted);
		text-align: center;
		padding: 0 20px;
	}

	.lumina-chat__empty-icon {
		font-size: 36px;
		margin-bottom: 6px;
		filter: drop-shadow(0 4px 8px rgba(168, 85, 247, 0.15));
	}

	.lumina-chat__empty p {
		font-size: 13.5px;
		font-weight: 600;
		margin: 0;
		color: var(--text-normal);
	}

	.lumina-chat__empty-sub {
		font-size: 11px;
		color: var(--text-muted) !important;
		opacity: 0.8;
	}

	.lumina-chat__setup-btn {
		margin-top: 8px;
		padding: 8px 16px;
		border-radius: 8px;
		border: 1px solid var(--interactive-accent);
		background: transparent;
		color: var(--interactive-accent);
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.lumina-chat__setup-btn:hover {
		background: var(--interactive-accent);
		color: white;
		box-shadow: 0 2px 8px rgba(139, 92, 246, 0.3);
		transform: translateY(-1px);
	}

	/* ── Input Area ── */
	.lumina-chat__input-area {
		flex-shrink: 0;
		padding: 6px 8px 2px;
		border-top: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.lumina-chat__input-toolbar {
		display: flex;
		justify-content: space-between;
		align-items: center;
		padding: 0 4px;
	}

	.lumina-chat__toolbar-group {
		display: flex;
		gap: 6px;
	}

	.lumina-chat__toolbar-btn {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 10px;
		font-weight: 600;
		color: var(--text-muted);
		background: transparent;
		border: none;
		border-radius: 4px;
		padding: 4px 6px;
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.lumina-chat__toolbar-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.lumina-chat__context-badge {
		display: flex;
		align-items: center;
		gap: 4px;
		font-size: 9px;
		font-weight: 600;
		padding: 3px 8px;
		border-radius: 4px;
		background: rgba(var(--mono-rgb-100), 0.05);
		color: var(--text-muted);
		border: 1px solid var(--background-modifier-border);
		cursor: pointer;
		transition: all 0.2s ease;
	}

	.lumina-chat__context-badge:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.lumina-chat__context-badge.is-active {
		background: rgba(var(--color-accent-rgb, 139, 92, 246), 0.12);
		color: var(--interactive-accent);
		border-color: var(--interactive-accent);
	}

	/* RAG 상태 배지 */
	.lumina-chat__rag-badge {
		font-size: 10px;
		font-weight: 700;
		padding: 0 6px;
		height: 22px;
		display: flex;
		align-items: center;
		justify-content: center;
		border-radius: 4px;
		border: 1px solid;
	}

	.lumina-chat__rag-badge--idle {
		background: rgba(156, 163, 175, 0.1);
		color: rgb(156, 163, 175);
		border-color: rgba(156, 163, 175, 0.3);
	}

	.lumina-chat__rag-badge--ready {
		background: rgba(34, 197, 94, 0.1);
		color: rgb(34, 197, 94);
		border-color: rgba(34, 197, 94, 0.3);
	}

	.lumina-chat__rag-badge--indexing {
		background: rgba(251, 191, 36, 0.1);
		color: rgb(251, 191, 36);
		border-color: rgba(251, 191, 36, 0.3);
		animation: lumina-pulse 1.5s ease-in-out infinite;
	}

	@keyframes lumina-pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.5;
		}
	}

	.lumina-chat__rag-banner {
		margin: 8px 8px 0;
		flex-shrink: 0;
		padding: 12px 16px;
		background: rgba(139, 92, 246, 0.08);
		border: 1px solid rgba(139, 92, 246, 0.3);
		border-radius: 8px;
		animation: lumina-pulse 2.5s ease-in-out infinite;
	}

	.lumina-chat__rag-banner-content {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.lumina-chat__rag-banner-content strong {
		color: var(--interactive-accent);
		font-size: 13px;
	}

	.lumina-chat__rag-banner-content span {
		color: var(--text-muted);
		font-size: 12px;
	}

	.lumina-chat__textarea-wrap {
		display: flex;
		align-items: flex-end;
		gap: 8px;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		border-radius: 12px;
		padding: 10px 12px;
		box-shadow:
			0 2px 8px rgba(0, 0, 0, 0.02),
			inset 0 1px 0 rgba(255, 255, 255, 0.02);
		transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.lumina-chat__textarea-wrap:focus-within {
		border-color: var(--interactive-accent);
		box-shadow:
			0 4px 16px rgba(139, 92, 246, 0.12),
			inset 0 1px 0 rgba(255, 255, 255, 0.02);
	}

	.lumina-chat__textarea {
		flex: 1;
		border: none;
		background: transparent;
		resize: none;
		font-size: 13px;
		line-height: 20px;
		color: var(--text-normal);
		font-family: var(--font-interface);
		outline: none;
		min-height: 30px;
		max-height: 160px;
		overflow-y: auto;
		padding: 5px 0;
	}

	.lumina-chat__textarea::-webkit-scrollbar {
		width: 4px;
	}

	.lumina-chat__textarea::-webkit-scrollbar-thumb {
		background: var(--background-modifier-border);
		border-radius: 2px;
	}

	.lumina-chat__textarea::placeholder {
		color: var(--text-faint);
	}

	.lumina-chat__textarea:disabled {
		opacity: 0.5;
	}

	.lumina-chat__send-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		padding: 0 !important;
		border-radius: 8px;
		border: none;
		background: var(--background-modifier-border);
		color: var(--text-muted);
		cursor: pointer;
		flex-shrink: 0;
		transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
	}

	.lumina-chat__send-btn :global(svg) {
		width: 22px !important;
		height: 22px !important;
		stroke-width: 2.2px !important;
	}

	.lumina-chat__clear-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		padding: 0;
		border-radius: 8px;
		border: none;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
		flex-shrink: 0;
		transition: all 0.2s ease;
	}

	.lumina-chat__clear-btn:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.lumina-chat__clear-btn :global(svg) {
		width: 18px !important;
		height: 18px !important;
		stroke-width: 2px !important;
	}

	.lumina-chat__send-btn.is-active {
		background: linear-gradient(
			135deg,
			var(--interactive-accent) 0%,
			#8b5cf6 100%
		);
		color: #ffffff;
		box-shadow: 0 2px 8px rgba(139, 92, 246, 0.3);
	}

	.lumina-chat__send-btn.is-active:hover {
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(139, 92, 246, 0.4);
	}

	.lumina-chat__send-btn:active {
		transform: scale(0.92);
	}

	.lumina-chat__send-btn:disabled {
		opacity: 0.4;
		cursor: default;
		background: var(--background-modifier-border) !important;
		color: var(--text-muted) !important;
		box-shadow: none !important;
		transform: none !important;
	}

	.lumina-chat__send-btn--cancel {
		background: var(--color-red) !important;
		color: white !important;
		opacity: 0.9 !important;
		box-shadow: 0 2px 8px rgba(239, 68, 68, 0.3) !important;
	}

	.lumina-chat__send-btn--cancel:hover {
		opacity: 1 !important;
		transform: translateY(-1px);
		box-shadow: 0 4px 12px rgba(239, 68, 68, 0.4) !important;
	}

	/* Attachments Chips */
	.lumina-chat__attachments {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		padding: 2px 4px 6px;
	}

	.lumina-chat__attachment-chip {
		display: flex;
		align-items: center;
		gap: 4px;
		background: var(--background-secondary-alt);
		border: 1px solid var(--background-modifier-border);
		border-radius: 12px;
		padding: 4px 8px;
		font-size: 11px;
		color: var(--text-normal);
		max-width: 100%;
	}

	.lumina-chat__attachment-icon {
		display: flex;
		align-items: center;
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.lumina-chat__attachment-icon :global(svg) {
		width: 12px;
		height: 12px;
	}

	.lumina-chat__attachment-name {
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lumina-chat__attachment-remove {
		display: flex;
		align-items: center;
		justify-content: center;
		background: transparent;
		border: none;
		color: var(--text-muted);
		cursor: pointer;
		padding: 2px;
		margin-left: 2px;
		border-radius: 50%;
		flex-shrink: 0;
	}

	.lumina-chat__attachment-remove:hover {
		background: var(--background-modifier-hover);
		color: var(--text-normal);
	}

	.lumina-chat__attachment-remove :global(svg) {
		width: 10px;
		height: 10px;
	}

	.lumina-chat__hint-inline {
		font-size: 11.5px;
		color: var(--text-faint);
		font-weight: 500;
	}

	.lumina-chat__token-stats {
		font-size: 11.5px;
		color: var(--text-muted);
		font-weight: 500;
		background: var(--background-primary);
		padding: 2px 6px;
		border-radius: 4px;
		border: 1px solid var(--background-modifier-border);
	}
</style>
