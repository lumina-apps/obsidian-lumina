<script lang="ts">
	import { onDestroy, onMount, untrack } from "svelte";
	import type LuminaPlugin from "../../../main";
	import {
		batchQueueCounts,
		batchStore,
		patchBatchState,
		setBatchRecipeOptions,
		setBatchScopeConfig,
		setBatchSelectedPath,
		updateBatchQueueItem,
	} from "../../../core/store/batchStore";
	import {
		FREE_MAX_BATCH_FILES,
		hasProFeature,
	} from "../../../core/store/entitlementStore";
	import {
		notifyProFeatureLocked,
		openProUpgradeModal,
	} from "../../../shared/utils/proUpgradeModal";
	import { verifiedProviders } from "../../../core/store/settingsStore";
	import { activeProject } from "../../../core/store/projectStore";
	import { tStore } from "../../../shared/locales/index";
	import type {
		BatchProposedChange,
		BatchQueueFilter,
		BatchQueueItem,
		BatchRecipeId,
		CustomOutputMode,
		FrontmatterMergeMode,
	} from "../../../shared/types/batch.types";
	import { icon } from "../../../shared/utils/iconAction";
	import {
		parseProviderModelValue,
		toProviderModelValue,
	} from "../../../shared/utils/modelUtils";
	import { BatchStudioController } from "../batchController";
	import {
		computeLineDiff,
		estimateBatchResources,
		listVaultFolders,
		resolveTargetFiles,
	} from "../batchTargetResolver";
	import { getBatchEligibleProviders } from "../recipes/batchRecipes";
	import { openLinkTextSafely } from "../../../shared/utils/workspaceNavUtils";

	let { plugin }: { plugin: LuminaPlugin } = $props();

	const controller = untrack(() => new BatchStudioController(plugin));

	let vaultTick = $state(0);
	let newTagInput = $state("");
	let confirmRollbackId = $state<string | null>(null);
	let customPromptTextareaEl = $state<HTMLTextAreaElement | null>(null);

	// 볼트 파일 및 메타데이터 변화 시 대상 노트 수 재계산 트리거 (대량 변경 시 디바운스로 부하 방지)
	onMount(() => {
		let bumpTimer: number | null = null;
		const bump = () => {
			if (bumpTimer !== null) {
				window.clearTimeout(bumpTimer);
			}
			bumpTimer = window.setTimeout(() => {
				bumpTimer = null;
				vaultTick++;
			}, 200);
		};
		const vaultRefs = [
			plugin.app.vault.on("create", bump),
			plugin.app.vault.on("delete", bump),
			plugin.app.vault.on("rename", bump),
		].filter((r): r is NonNullable<typeof r> => Boolean(r));
		const metaRef = plugin.app.metadataCache?.on("changed", bump);

		return () => {
			if (bumpTimer !== null) {
				window.clearTimeout(bumpTimer);
				bumpTimer = null;
			}
			for (const ref of vaultRefs) {
				plugin.app.vault.offref(ref);
			}
			if (metaRef) {
				plugin.app.metadataCache?.offref(metaRef);
			}
		};
	});

	onDestroy(() => {
		// 탭을 닫아도 실행 중인 배치가 계속 돌 수 있게 controller는 cancel하지 않고,
		// 플러그인 언로드 시 main.ts에서 abortActiveBatchRun()을 호출합니다.
	});

	const state = $derived($batchStore);
	const counts = $derived($batchQueueCounts);
	const isProBatch = hasProFeature("batch-studio");
	const isRunningOrPaused = $derived(
		state.runState === "running" || state.runState === "paused",
	);

	$effect(() => {
		if (!$isProBatch && state.activeRecipeId === "custom-prompt" && !isRunningOrPaused) {
			patchBatchState({ activeRecipeId: "frontmatter" });
		}
	});

	// 사용 가능한 프로바이더 및 모델 옵션
	const eligibleProviders = $derived(getBatchEligibleProviders($verifiedProviders));
	const modelOptions = $derived.by(() => {
		const opts: Array<{ value: string; label: string; providerType: string }> = [];
		for (const p of eligibleProviders) {
			for (const m of p.availableModels) {
				opts.push({
					value: toProviderModelValue(p.id, m),
					label: `${p.type} · ${m}`,
					providerType: p.type,
				});
			}
		}
		return opts;
	});

	const selectedModelValue = $derived(
		state.recipeOptions.providerId && state.recipeOptions.modelId
			? toProviderModelValue(state.recipeOptions.providerId, state.recipeOptions.modelId)
			: "",
	);

	const activeProviderType = $derived.by(() => {
		if (state.recipeOptions.providerId) {
			return (
				eligibleProviders.find((p) => p.id === state.recipeOptions.providerId)?.type ??
				undefined
			);
		}
		const taskId = plugin.settings.connections.taskProviderId;
		return eligibleProviders.find((p) => p.id === taskId)?.type ?? eligibleProviders[0]?.type;
	});

	// 볼트 내 폴더 목록 (자동완성용)
	const vaultFolders = $derived.by(() => {
		void vaultTick;
		return listVaultFolders(plugin.app);
	});

	// 필터링된 대상 노트 및 리소스 추산
	const resolution = $derived.by(() => {
		void vaultTick;
		return resolveTargetFiles(
			plugin.app,
			state.scopeConfig,
			state.activeRecipeId,
			state.recipeOptions,
			$activeProject?.ragExcludedPaths ?? [],
		);
	});

	const effectiveMatchedForEstimate = $derived(
		$isProBatch ? resolution.matched : resolution.matched.slice(0, FREE_MAX_BATCH_FILES),
	);
	const lockedPreviewCount = $derived(
		!$isProBatch ? Math.max(0, resolution.matched.length - FREE_MAX_BATCH_FILES) : 0,
	);

	const resourceEstimate = $derived(
		estimateBatchResources(effectiveMatchedForEstimate, state.activeRecipeId, activeProviderType),
	);

	// 필터된 큐 목록
	const filteredQueue = $derived.by(() => {
		const f = state.queueFilter;
		if (f === "all") return state.queue;
		return state.queue.filter((item) => item.status === f);
	});

	const stagedItems = $derived(state.queue.filter((q) => q.status === "staged"));
	const allStagedSelected = $derived(
		stagedItems.length > 0 && stagedItems.every((q) => q.selected),
	);

	// 우측 검수 패널에 표시할 선택 항목
	const selectedItem = $derived(
		state.queue.find((q) => q.path === state.selectedPath) ?? null,
	);

	const selectedLineDiff = $derived.by(() => {
		if (
			selectedItem?.proposed?.kind === "content" &&
			selectedItem.proposed.beforeContent !== undefined &&
			selectedItem.proposed.afterContent !== undefined
		) {
			return computeLineDiff(
				selectedItem.proposed.beforeContent,
				selectedItem.proposed.afterContent,
			);
		}
		return [];
	});

	const sampleLineDiff = $derived.by(() => {
		if (
			state.sampleResult?.kind === "content" &&
			state.sampleResult.beforeContent !== undefined &&
			state.sampleResult.afterContent !== undefined
		) {
			return computeLineDiff(
				state.sampleResult.beforeContent,
				state.sampleResult.afterContent,
			);
		}
		return [];
	});

	const progressPercent = $derived(
		counts.total > 0 ? Math.round((counts.done / counts.total) * 100) : 0,
	);

	const recipeDefs = $derived<
		Array<{ id: BatchRecipeId; iconName: string; label: string; desc: string }>
	>([
		{
			id: "frontmatter",
			iconName: "tags",
			label: $tStore("batchStudio.recipes.frontmatter"),
			desc: $tStore("batchStudio.recipes.frontmatterDesc"),
		},
		{
			id: "autolink",
			iconName: "link",
			label: $tStore("batchStudio.recipes.autolink"),
			desc: $tStore("batchStudio.recipes.autolinkDesc"),
		},
		{
			id: "summary-callout",
			iconName: "file-text",
			label: $tStore("batchStudio.recipes.summaryCallout"),
			desc: $tStore("batchStudio.recipes.summaryCalloutDesc"),
		},
		{
			id: "custom-prompt",
			iconName: "sparkles",
			label: $tStore("batchStudio.recipes.customPrompt"),
			desc: $tStore("batchStudio.recipes.customPromptDesc"),
		},
	]);

	const activeRecipeDef = $derived(
		recipeDefs.find((r) => r.id === state.activeRecipeId) ?? recipeDefs[0],
	);

	// ── UI Event Handlers ──────────────────────────────────────────────────

	function handleRecipeChange(recipeId: BatchRecipeId): void {
		if (isRunningOrPaused) return;
		if (recipeId === "custom-prompt" && !$isProBatch) {
			notifyProFeatureLocked(
				plugin.app,
				"batch-studio",
				$tStore("batchStudio.proCustomPromptNotice"),
			);
			return;
		}
		patchBatchState({
			activeRecipeId: recipeId,
			sampleResult: null,
			sampleNoChanges: false,
			sampleError: null,
		});
	}

	function handleModelSelect(rawVal: string): void {
		if (!rawVal) {
			setBatchRecipeOptions({ providerId: "", modelId: "" });
			return;
		}
		const parsed = parseProviderModelValue(rawVal);
		if (parsed) {
			setBatchRecipeOptions({ providerId: parsed.providerId, modelId: parsed.modelId });
		}
	}

	function insertTemplateVar(variable: string): void {
		const token = `{{${variable}}}`;
		const el = customPromptTextareaEl;
		const current = state.recipeOptions.customPrompt;
		if (el && typeof el.selectionStart === "number") {
			const start = el.selectionStart;
			const end = el.selectionEnd ?? start;
			const next = current.slice(0, start) + token + current.slice(end);
			setBatchRecipeOptions({ customPrompt: next });
			window.setTimeout(() => {
				el.focus();
				el.setSelectionRange(start + token.length, start + token.length);
			}, 0);
		} else {
			setBatchRecipeOptions({ customPrompt: current ? `${current} ${token}` : token });
		}
	}

	function toggleSelectAllStaged(): void {
		const nextVal = !allStagedSelected;
		for (const item of stagedItems) {
			updateBatchQueueItem(item.path, { selected: nextVal });
		}
	}

	function handleRemoveTag(item: BatchQueueItem, tagToRemove: string): void {
		if (!item.proposed?.afterTags) return;
		const nextTags = item.proposed.afterTags.filter((t) => t !== tagToRemove);
		controller.updateProposedFrontmatter(item.path, { afterTags: nextTags });
	}

	function handleAddTag(item: BatchQueueItem): void {
		const cleaned = newTagInput.trim().replace(/^#+/, "").trim();
		if (!cleaned) return;
		const current = item.proposed?.afterTags ?? [];
		if (!current.some((t) => t.toLowerCase() === cleaned.toLowerCase())) {
			controller.updateProposedFrontmatter(item.path, {
				afterTags: [...current, cleaned],
			});
		}
		newTagInput = "";
	}

	function handleInspectorKeydown(e: KeyboardEvent): void {
		if (!selectedItem || selectedItem.status !== "staged") return;
		const target = e.target as HTMLElement | null;
		const tag = target?.tagName?.toLowerCase();
		if (tag === "input" || tag === "textarea" || tag === "select") return;

		if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
			e.preventDefault();
			void controller.applySingleItem(selectedItem.path);
		}
	}

	function getStatusIcon(status: BatchQueueItem["status"]): string {
		switch (status) {
			case "queued":
				return "clock";
			case "running":
				return "loader";
			case "staged":
				return "eye";
			case "applied":
				return "check-circle";
			case "rejected":
				return "x-circle";
			case "skipped":
				return "skip-forward";
			case "failed":
				return "alert-triangle";
			case "locked":
				return "lock";
		}
	}

	function getStatusLabel(status: BatchQueueItem["status"]): string {
		switch (status) {
			case "queued":
				return $tStore("batchStudio.queue.statusQueued");
			case "running":
				return $tStore("batchStudio.queue.statusRunning");
			case "staged":
				return $tStore("batchStudio.queue.statusStaged");
			case "applied":
				return $tStore("batchStudio.queue.statusApplied");
			case "rejected":
				return $tStore("batchStudio.queue.statusRejected");
			case "skipped":
				return $tStore("batchStudio.queue.statusSkipped");
			case "failed":
				return $tStore("batchStudio.queue.statusFailed");
			case "locked":
				return $tStore("batchStudio.queue.statusLocked");
		}
	}

	function getRecipeLabel(recipeId: BatchRecipeId): string {
		switch (recipeId) {
			case "frontmatter":
				return $tStore("batchStudio.recipes.frontmatter");
			case "autolink":
				return $tStore("batchStudio.recipes.autolink");
			case "summary-callout":
				return $tStore("batchStudio.recipes.summaryCallout");
			case "custom-prompt":
				return $tStore("batchStudio.recipes.customPrompt");
		}
	}

	function formatTimestamp(ts: number): string {
		return new Date(ts).toLocaleString();
	}

	function openNoteInWorkspace(path: string): void {
		void openLinkTextSafely(plugin.app, path, "", false);
	}
</script>

<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<div class="lumina-batch-studio" onkeydown={handleInspectorKeydown} role="region" aria-label={$tStore("batchStudio.title")}>
	<!-- 상단 헤더 & 레시피 탭 -->
	<header class="lumina-batch-header">
		<div class="lumina-batch-brand">
			<span class="lumina-batch-brand__icon" use:icon={"lumina-batch-studio"}></span>
			<h2 class="lumina-batch-brand__title">{$tStore("batchStudio.title")}</h2>
			<span class="lumina-batch-pro-badge">{$tStore("batchStudio.proBadge")}</span>
		</div>

		<div class="lumina-batch-recipes" role="tablist">
			{#each recipeDefs as recipe (recipe.id)}
				{@const isRecipeLocked = recipe.id === "custom-prompt" && !$isProBatch}
				<button
					type="button"
					class="lumina-batch-recipe-tab"
					class:is-active={state.activeRecipeId === recipe.id}
					class:is-locked={isRecipeLocked}
					disabled={isRunningOrPaused}
					title={isRecipeLocked ? `${recipe.desc} (PRO)` : recipe.desc}
					onclick={() => handleRecipeChange(recipe.id)}
				>
					<span class="lumina-batch-tab-icon" use:icon={recipe.iconName}></span>
					<span>{recipe.label}</span>
					{#if isRecipeLocked}
						<span class="lumina-batch-lock-tag" aria-hidden="true">🔒</span>
					{/if}
				</button>
			{/each}
		</div>

		<div class="lumina-batch-main-tabs">
			<button
				type="button"
				class="lumina-batch-main-tab"
				class:is-active={state.activeMainTab === "workspace"}
				onclick={() => patchBatchState({ activeMainTab: "workspace" })}
			>
				<span class="lumina-batch-tab-icon" use:icon={"sliders"}></span>
				<span>{$tStore("batchStudio.workspaceTab")}</span>
			</button>
			<button
				type="button"
				class="lumina-batch-main-tab"
				class:is-active={state.activeMainTab === "history"}
				onclick={() => patchBatchState({ activeMainTab: "history" })}
			>
				<span class="lumina-batch-tab-icon" use:icon={"history"}></span>
				<span>{$tStore("batchStudio.history.tabTitle")} ({state.history.length})</span>
			</button>
		</div>
	</header>

	{#if state.activeMainTab === "history"}
		<!-- 히스토리 및 원클릭 롤백 탭 -->
		<section class="lumina-batch-history-pane">
			{#if state.history.length === 0}
				<div class="lumina-batch-empty">
					<span class="lumina-batch-empty__icon" use:icon={"history"}></span>
					<p>{$tStore("batchStudio.history.emptyHistory")}</p>
				</div>
			{:else}
				<div class="lumina-batch-history-list">
					{#each state.history as entry (entry.id)}
						<div class="lumina-batch-history-card">
							<div class="lumina-batch-history-card__top">
								<div>
									<div class="lumina-batch-history-card__title">
										{$tStore("batchStudio.history.batchSummary", {
											recipe: getRecipeLabel(entry.recipeId),
											count: entry.appliedCount,
										})}
									</div>
									<div class="lumina-batch-history-card__meta">
										{formatTimestamp(entry.timestamp)}
									</div>
								</div>

								<div>
									{#if entry.rolledBack}
										<span class="lumina-batch-status-pill is-applied">
											{$tStore("batchStudio.history.rolledBackBadge")}
										</span>
									{:else if confirmRollbackId === entry.id}
										<div class="lumina-batch-confirm-inline">
											<span class="lumina-batch-confirm-inline__text">
												{$tStore("batchStudio.history.rollbackConfirm", {
													count: entry.snapshots.length,
												})}
											</span>
											<button
												type="button"
												class="mod-warning"
												onclick={() => {
													confirmRollbackId = null;
													void controller.rollbackHistoryEntry(entry.id);
												}}
											>
												{$tStore("batchStudio.history.rollbackBtn")}
											</button>
											<button
												type="button"
												onclick={() => (confirmRollbackId = null)}
											>
												{$tStore("common.cancel")}
											</button>
										</div>
									{:else}
										<button
											type="button"
											class="lumina-batch-btn"
											onclick={() => (confirmRollbackId = entry.id)}
										>
											<span class="lumina-batch-tab-icon" use:icon={"rotate-ccw"}></span>
											<span>{$tStore("batchStudio.history.rollbackBtn")}</span>
										</button>
									{/if}
								</div>
							</div>

							<div class="lumina-batch-history-card__files">
								{#each entry.snapshots.slice(0, 12) as snap (snap.path)}
									<span class="lumina-batch-file-chip">{snap.path}</span>
								{/each}
								{#if entry.snapshots.length > 12}
									<span class="lumina-batch-file-chip">+{entry.snapshots.length - 12}</span>
								{/if}
							</div>
						</div>
					{/each}
				</div>
			{/if}
		</section>
	{:else}
		<!-- 작업 공간 탭: 접이식 설정 + 진행률 바 + 2-Pane 검수 워크벤치 -->
		<section class="lumina-batch-config-section">
			{#if state.isConfigCollapsed}
				<div class="lumina-batch-collapsed-bar">
					<div class="lumina-batch-collapsed-bar__summary">
						<span class="lumina-batch-tab-icon" use:icon={"folder"}></span>
						<span>
							{$tStore("batchStudio.target.collapsedSummary", {
								scope:
									state.scopeConfig.scopeMode === "folder" && state.scopeConfig.folderPath
										? state.scopeConfig.folderPath
										: $tStore("batchStudio.target.scopeVault"),
								recipe: activeRecipeDef.label,
								count: counts.total > 0 ? counts.total : effectiveMatchedForEstimate.length,
							})}
						</span>
					</div>
					<button
						type="button"
						class="lumina-batch-btn-ghost"
						onclick={() => patchBatchState({ isConfigCollapsed: false })}
					>
						<span>{$tStore("batchStudio.target.expandConfig")}</span>
						<span class="lumina-batch-tab-icon" use:icon={"chevron-down"}></span>
					</button>
				</div>
			{:else}
				<div class="lumina-batch-setup-grid">
					<!-- Step 1: 대상 노트 및 스마트 필터 -->
					<div class="lumina-batch-card">
						<div class="lumina-batch-card__header">
							<h3>{$tStore("batchStudio.target.sectionTitle")}</h3>
							{#if state.queue.length > 0}
								<button
									type="button"
									class="lumina-batch-btn-ghost"
									onclick={() => patchBatchState({ isConfigCollapsed: true })}
								>
									<span>{$tStore("batchStudio.target.collapseConfig")}</span>
									<span class="lumina-batch-tab-icon" use:icon={"chevron-up"}></span>
								</button>
							{/if}
						</div>

						<div class="lumina-batch-field-row">
							<div class="lumina-batch-segmented">
								<button
									type="button"
									class:is-active={state.scopeConfig.scopeMode === "vault"}
									disabled={isRunningOrPaused}
									onclick={() => setBatchScopeConfig({ scopeMode: "vault" })}
								>
									{$tStore("batchStudio.target.scopeVault")}
								</button>
								<button
									type="button"
									class:is-active={state.scopeConfig.scopeMode === "folder"}
									disabled={isRunningOrPaused}
									onclick={() => setBatchScopeConfig({ scopeMode: "folder" })}
								>
									{$tStore("batchStudio.target.scopeFolder")}
								</button>
							</div>
						</div>

						{#if state.scopeConfig.scopeMode === "folder"}
							<div class="lumina-batch-field">
								<input
									type="text"
									list="lumina-batch-folder-list"
									class="lumina-batch-input"
									disabled={isRunningOrPaused}
									placeholder={$tStore("batchStudio.target.folderPlaceholder")}
									value={state.scopeConfig.folderPath}
									oninput={(e) =>
										setBatchScopeConfig({
											folderPath: (e.currentTarget as HTMLInputElement).value,
										})}
								/>
								<datalist id="lumina-batch-folder-list">
									{#each vaultFolders as folder (folder)}
										<option value={folder}></option>
									{/each}
								</datalist>
							</div>
						{/if}

						<div class="lumina-batch-field-split">
							<input
								type="text"
								class="lumina-batch-input"
								disabled={isRunningOrPaused}
								placeholder={$tStore("batchStudio.target.tagFilterPlaceholder")}
								value={state.scopeConfig.tagFilter}
								oninput={(e) =>
									setBatchScopeConfig({
										tagFilter: (e.currentTarget as HTMLInputElement).value,
									})}
							/>
							<label class="lumina-batch-inline-num">
								<span>{$tStore("batchStudio.target.minCharsLabel")}</span>
								<input
									type="number"
									min="0"
									step="10"
									class="lumina-batch-input is-short"
									disabled={isRunningOrPaused}
									value={state.scopeConfig.minContentLength}
									oninput={(e) =>
										setBatchScopeConfig({
											minContentLength: Math.max(
												0,
												Number((e.currentTarget as HTMLInputElement).value) || 0,
											),
										})}
								/>
							</label>
						</div>

						{#if state.activeRecipeId !== "autolink"}
							<label class="lumina-batch-checkbox-row">
								<input
									type="checkbox"
									disabled={isRunningOrPaused}
									checked={state.scopeConfig.skipIfAlreadyHasTarget}
									onchange={(e) =>
										setBatchScopeConfig({
											skipIfAlreadyHasTarget: (e.currentTarget as HTMLInputElement).checked,
										})}
								/>
								<span>
									{state.activeRecipeId === "summary-callout"
										? $tStore("batchStudio.target.skipExistingCallout")
										: $tStore("batchStudio.target.skipExistingFm")}
								</span>
							</label>
						{/if}

						<div class="lumina-batch-target-summary">
							<div class="lumina-batch-target-summary__main">
								{$tStore("batchStudio.target.matchedSummary", {
									matched: resolution.matched.length,
									skipped: resolution.skippedCount,
									total: resolution.totalScanned,
								})}
							</div>
							<div class="lumina-batch-target-summary__est">
								{#if state.activeRecipeId === "autolink"}
									{$tStore("batchStudio.execution.estimateLocalOnly", {
										seconds: resourceEstimate.estimatedSeconds,
									})}
								{:else}
									{$tStore("batchStudio.execution.estimateSummary", {
										tokens: resourceEstimate.estimatedTokens.toLocaleString(),
										seconds: resourceEstimate.estimatedSeconds,
									})}
								{/if}
							</div>
						</div>
					</div>

					<!-- Step 2: 레시피 옵션 & 1개 샘플 테스트 -->
					<div class="lumina-batch-card">
						<div class="lumina-batch-card__header">
							<h3>{$tStore("batchStudio.options.sectionTitle")}</h3>
							<span class="lumina-batch-recipe-desc">{activeRecipeDef.desc}</span>
						</div>

						{#if state.activeRecipeId === "autolink"}
							<div class="lumina-batch-info-banner">
								{$tStore("batchStudio.options.localOnlyAutolinkNotice")}
							</div>
						{:else}
							<div class="lumina-batch-field-row">
								<label class="lumina-batch-label" for="lumina-batch-model-select">
									{$tStore("batchStudio.options.modelLabel")}
								</label>
								<select
									id="lumina-batch-model-select"
									class="lumina-batch-select"
									disabled={isRunningOrPaused}
									value={selectedModelValue}
									onchange={(e) =>
										handleModelSelect((e.currentTarget as HTMLSelectElement).value)}
								>
									<option value="">{$tStore("batchStudio.options.modelAutoTask")}</option>
									{#each modelOptions as opt (opt.value)}
										<option value={opt.value}>{opt.label}</option>
									{/each}
								</select>
							</div>
						{/if}

						{#if state.activeRecipeId === "frontmatter"}
							<div class="lumina-batch-options-group">
								<div class="lumina-batch-checkbox-inline">
									<label class="lumina-batch-checkbox-row">
										<input
											type="checkbox"
											disabled={isRunningOrPaused}
											checked={state.recipeOptions.generateTags}
											onchange={(e) =>
												setBatchRecipeOptions({
													generateTags: (e.currentTarget as HTMLInputElement).checked,
												})}
										/>
										<span>{$tStore("batchStudio.options.generateTagsLabel")}</span>
									</label>
									<label class="lumina-batch-checkbox-row">
										<input
											type="checkbox"
											disabled={isRunningOrPaused}
											checked={state.recipeOptions.generateDescription}
											onchange={(e) =>
												setBatchRecipeOptions({
													generateDescription: (e.currentTarget as HTMLInputElement)
														.checked,
												})}
										/>
										<span>{$tStore("batchStudio.options.generateDescriptionLabel")}</span>
									</label>
								</div>

								<div class="lumina-batch-field-row">
									<label class="lumina-batch-label" for="lumina-batch-fm-mode">
										{$tStore("batchStudio.options.fmMergeModeLabel")}
									</label>
									<select
										id="lumina-batch-fm-mode"
										class="lumina-batch-select"
										disabled={isRunningOrPaused}
										value={state.recipeOptions.fmMergeMode}
										onchange={(e) =>
											setBatchRecipeOptions({
												fmMergeMode: (e.currentTarget as HTMLSelectElement)
													.value as FrontmatterMergeMode,
											})}
									>
										<option value="empty-only">
											{$tStore("batchStudio.options.fmModeEmptyOnly")}
										</option>
										<option value="merge">
											{$tStore("batchStudio.options.fmModeMerge")}
										</option>
										<option value="overwrite">
											{$tStore("batchStudio.options.fmModeOverwrite")}
										</option>
									</select>
								</div>
							</div>
						{:else if state.activeRecipeId === "summary-callout"}
							<div class="lumina-batch-field-row">
								<label class="lumina-batch-label" for="lumina-batch-callout-title">
									{$tStore("batchStudio.options.calloutTitleLabel")}
								</label>
								<input
									id="lumina-batch-callout-title"
									type="text"
									class="lumina-batch-input"
									disabled={isRunningOrPaused}
									placeholder={$tStore("batchStudio.options.calloutTitlePlaceholder")}
									value={state.recipeOptions.calloutTitle}
									oninput={(e) =>
										setBatchRecipeOptions({
											calloutTitle: (e.currentTarget as HTMLInputElement).value,
										})}
								/>
							</div>
						{:else if state.activeRecipeId === "custom-prompt"}
							<div class="lumina-batch-options-group">
								<div class="lumina-batch-var-chips">
									<span class="lumina-batch-var-chips__hint">
										{$tStore("batchStudio.options.insertVarHint")}
									</span>
									{#each ["title", "content", "frontmatter", "folder"] as v (v)}
										<button
											type="button"
											class="lumina-batch-chip-btn"
											disabled={isRunningOrPaused}
											onclick={() => insertTemplateVar(v)}
										>
											{`{{${v}}}`}
										</button>
									{/each}
								</div>
								<textarea
									bind:this={customPromptTextareaEl}
									class="lumina-batch-textarea"
									rows="3"
									disabled={isRunningOrPaused}
									placeholder={$tStore("batchStudio.options.customPromptPlaceholder")}
									value={state.recipeOptions.customPrompt}
									oninput={(e) =>
										setBatchRecipeOptions({
											customPrompt: (e.currentTarget as HTMLTextAreaElement).value,
										})}
								></textarea>
								<div class="lumina-batch-field-split">
									<select
										class="lumina-batch-select"
										disabled={isRunningOrPaused}
										value={state.recipeOptions.customOutputMode}
										onchange={(e) =>
											setBatchRecipeOptions({
												customOutputMode: (e.currentTarget as HTMLSelectElement)
													.value as CustomOutputMode,
											})}
									>
										<option value="frontmatter-key">
											{$tStore("batchStudio.options.outputFmKey")}
										</option>
										<option value="prepend">
											{$tStore("batchStudio.options.outputPrepend")}
										</option>
										<option value="append">
											{$tStore("batchStudio.options.outputAppend")}
										</option>
										<option value="replace">
											{$tStore("batchStudio.options.outputReplace")}
										</option>
									</select>
									{#if state.recipeOptions.customOutputMode === "frontmatter-key"}
										<input
											type="text"
											class="lumina-batch-input"
											disabled={isRunningOrPaused}
											placeholder={$tStore("batchStudio.options.fmKeyPlaceholder")}
											value={state.recipeOptions.customFrontmatterKey}
											oninput={(e) =>
												setBatchRecipeOptions({
													customFrontmatterKey: (
														e.currentTarget as HTMLInputElement
													).value,
												})}
										/>
									{/if}
								</div>
							</div>
						{/if}

						<!-- 1개 샘플 테스트 영역 -->
						<div class="lumina-batch-sample-box">
							<div class="lumina-batch-sample-box__controls">
								<select
									class="lumina-batch-select"
									disabled={resolution.matched.length === 0 || state.sampleRunning}
									value={state.sampleFilePath || resolution.matched[0]?.path || ""}
									onchange={(e) =>
										patchBatchState({
											sampleFilePath: (e.currentTarget as HTMLSelectElement).value,
											sampleResult: null,
											sampleNoChanges: false,
											sampleError: null,
										})}
								>
									{#if resolution.matched.length === 0}
										<option value="">{$tStore("batchStudio.sample.noTargetNotes")}</option>
									{:else}
										{#each resolution.matched.slice(0, 100) as f (f.path)}
											<option value={f.path}>{f.path}</option>
										{/each}
									{/if}
								</select>

								<button
									type="button"
									class="lumina-batch-btn"
									disabled={
										resolution.matched.length === 0 ||
										state.sampleRunning ||
										isRunningOrPaused
									}
									onclick={() => void controller.runSampleTest()}
								>
									<span class="lumina-batch-tab-icon" use:icon={"play"}></span>
									<span>
										{state.sampleRunning
											? $tStore("batchStudio.sample.runningSample")
											: $tStore("batchStudio.sample.runSampleBtn")}
									</span>
								</button>
							</div>

							{#if state.sampleError}
								<div class="lumina-batch-sample-msg is-error">
									{$tStore("batchStudio.sample.sampleError", { error: state.sampleError })}
								</div>
							{:else if state.sampleNoChanges}
								<div class="lumina-batch-sample-msg">
									{$tStore("batchStudio.sample.sampleNoChanges")}
								</div>
							{:else if state.sampleResult}
								<div class="lumina-batch-sample-preview">
									{#if state.sampleResult.kind === "frontmatter"}
										{#if state.sampleResult.customFmKey}
											<div>
												<strong>{state.sampleResult.customFmKey}:</strong>
												<span>{state.sampleResult.afterCustomFmVal}</span>
											</div>
										{:else}
											{#if state.sampleResult.afterTags}
												<div class="lumina-batch-sample-row">
													<span class="lumina-batch-sample-key">tags:</span>
													<div class="lumina-batch-tag-list">
														{#each state.sampleResult.afterTags as tag (tag)}
															<span class="lumina-batch-tag-pill">#{tag}</span>
														{/each}
													</div>
												</div>
											{/if}
											{#if state.sampleResult.afterDescription}
												<div class="lumina-batch-sample-row">
													<span class="lumina-batch-sample-key">description:</span>
													<span>{state.sampleResult.afterDescription}</span>
												</div>
											{/if}
										{/if}
									{:else}
										<div class="lumina-batch-diff-preview is-compact">
											{#each sampleLineDiff.filter((l) => l.type !== "same").slice(0, 10) as line, i (i)}
												<div class="lumina-batch-diff-line is-{line.type}">
													<span class="lumina-batch-diff-prefix">
														{line.type === "added" ? "+" : "-"}
													</span>
													<span>{line.text}</span>
												</div>
											{/each}
										</div>
									{/if}
								</div>
							{/if}
						</div>
					</div>
				</div>

				<!-- 실행 시작 푸터 -->
				<div class="lumina-batch-setup-footer">
					<div class="lumina-batch-safety-note">
						<span class="lumina-batch-tab-icon" use:icon={"shield-check"}></span>
						<span>{$tStore("batchStudio.execution.snapshotNotice")}</span>
					</div>
					<button
						type="button"
						class="mod-cta lumina-batch-start-btn"
						disabled={resolution.matched.length === 0 || isRunningOrPaused}
						onclick={() => void controller.startBatch()}
					>
						<span class="lumina-batch-tab-icon" use:icon={"zap"}></span>
						<span>
							{#if lockedPreviewCount > 0}
								{$tStore("batchStudio.execution.startBtnFreeLimited", {
									free: FREE_MAX_BATCH_FILES,
									locked: lockedPreviewCount,
								})}
							{:else}
								{$tStore("batchStudio.execution.startBtn", {
									count: resolution.matched.length,
								})}
							{/if}
						</span>
					</button>
				</div>
			{/if}
		</section>

		<!-- 진행률 바 (배치 시작 이후 표시) -->
		{#if state.queue.length > 0}
			<section class="lumina-batch-progress-bar-wrap">
				<div class="lumina-batch-progress-meta">
					<div class="lumina-batch-progress-meta__left">
						<span class="lumina-batch-status-pill is-{state.runState}">
							{#if state.runState === "running"}
								{$tStore("batchStudio.execution.statusRunning")}
							{:else if state.runState === "paused"}
								{$tStore("batchStudio.execution.statusPaused")}
							{:else if state.runState === "completed"}
								{$tStore("batchStudio.execution.statusCompleted")}
							{:else}
								{$tStore("batchStudio.execution.statusIdle")}
							{/if}
						</span>
						<span class="lumina-batch-progress-text">
							{$tStore("batchStudio.execution.progressSummary", {
								done: counts.done,
								total: counts.total,
								percent: progressPercent,
							})}
						</span>
						{#if state.rateLimitCountdownSec !== null}
							<span class="lumina-batch-rate-limit">
								{$tStore("batchStudio.execution.rateLimitWaiting", {
									seconds: state.rateLimitCountdownSec,
								})}
							</span>
						{/if}
					</div>

					<div class="lumina-batch-progress-actions">
						{#if state.runState === "running"}
							<button type="button" class="lumina-batch-btn" onclick={() => controller.pauseBatch()}>
								<span class="lumina-batch-tab-icon" use:icon={"pause"}></span>
								<span>{$tStore("batchStudio.execution.pauseBtn")}</span>
							</button>
							<button type="button" class="mod-warning" onclick={() => controller.cancelBatch()}>
								<span class="lumina-batch-tab-icon" use:icon={"square"}></span>
								<span>{$tStore("batchStudio.execution.cancelBtn")}</span>
							</button>
						{:else if state.runState === "paused"}
							<button type="button" class="mod-cta" onclick={() => controller.resumeBatch()}>
								<span class="lumina-batch-tab-icon" use:icon={"play"}></span>
								<span>{$tStore("batchStudio.execution.resumeBtn")}</span>
							</button>
							<button type="button" class="mod-warning" onclick={() => controller.cancelBatch()}>
								<span class="lumina-batch-tab-icon" use:icon={"square"}></span>
								<span>{$tStore("batchStudio.execution.cancelBtn")}</span>
							</button>
						{:else if counts.failed > 0}
							<button
								type="button"
								class="lumina-batch-btn"
								onclick={() => void controller.retryFailedItems()}
							>
								<span class="lumina-batch-tab-icon" use:icon={"refresh-cw"}></span>
								<span>
									{$tStore("batchStudio.execution.retryFailedBtn", {
										count: counts.failed,
									})}
								</span>
							</button>
						{/if}
					</div>
				</div>

				<div class="lumina-batch-progress-track">
					<div class="lumina-batch-progress-fill" style={`width: ${progressPercent}%`}></div>
				</div>
			</section>

			<!-- 하단 2-Pane 검수 워크벤치 -->
			<section class="lumina-batch-workbench">
				<!-- 좌측 큐 리스트 -->
				<aside class="lumina-batch-queue-pane">
					<div class="lumina-batch-queue-filters">
						{#each [
							{ id: "all", label: $tStore("batchStudio.queue.tabAll"), count: counts.total + counts.locked },
							{ id: "staged", label: $tStore("batchStudio.queue.tabStaged"), count: counts.staged },
							{ id: "applied", label: $tStore("batchStudio.queue.tabApplied"), count: counts.applied },
							{ id: "skipped", label: $tStore("batchStudio.queue.tabSkipped"), count: counts.skipped },
							{ id: "failed", label: $tStore("batchStudio.queue.tabFailed"), count: counts.failed },
						] as tab (tab.id)}
							<button
								type="button"
								class="lumina-batch-filter-tab"
								class:is-active={state.queueFilter === tab.id}
								onclick={() =>
									patchBatchState({ queueFilter: tab.id as BatchQueueFilter })}
							>
								<span>{tab.label}</span>
								<span class="lumina-batch-filter-tab__cnt">{tab.count}</span>
							</button>
						{/each}
					</div>

					{#if stagedItems.length > 0}
						<div class="lumina-batch-queue-bulkbar">
							<button
								type="button"
								class="lumina-batch-btn-ghost"
								onclick={toggleSelectAllStaged}
							>
								{allStagedSelected
									? $tStore("batchStudio.queue.deselectAll")
									: $tStore("batchStudio.queue.selectAll")}
							</button>
						</div>
					{/if}

					<div class="lumina-batch-queue-list">
						{#each filteredQueue as item (item.path)}
							<div
								class="lumina-batch-queue-item"
								class:is-selected={state.selectedPath === item.path}
								class:is-locked={item.status === "locked"}
								role="button"
								tabindex="0"
								onclick={() => setBatchSelectedPath(item.path)}
								onkeydown={(e) => {
									if (e.key === "Enter" || e.key === " ") {
										e.preventDefault();
										setBatchSelectedPath(item.path);
									}
								}}
							>
								<input
									type="checkbox"
									checked={item.selected}
									disabled={item.status !== "staged"}
									onclick={(e) => e.stopPropagation()}
									onchange={(e) =>
										updateBatchQueueItem(item.path, {
											selected: (e.currentTarget as HTMLInputElement).checked,
										})}
								/>
								<span
									class="lumina-batch-queue-item__icon is-{item.status}"
									use:icon={getStatusIcon(item.status)}
								></span>
								<div class="lumina-batch-queue-item__body">
									<div class="lumina-batch-queue-item__name">{item.basename}</div>
									<div class="lumina-batch-queue-item__path">{item.path}</div>
								</div>
								{#if item.status === "locked"}
									<span class="lumina-batch-queue-item__badge is-pro">PRO</span>
								{:else if item.proposed?.summaryText}
									<span class="lumina-batch-queue-item__badge">
										{item.proposed.summaryText}
									</span>
								{/if}
							</div>
						{/each}
					</div>
				</aside>

				<!-- 우측 변경사항 상세 검수 패널 -->
				<div class="lumina-batch-inspector-pane">
					{#if !selectedItem}
						<div class="lumina-batch-empty">
							<span class="lumina-batch-empty__icon" use:icon={"file-search"}></span>
							<p>{$tStore("batchStudio.inspector.emptySelection")}</p>
						</div>
					{:else}
						<div class="lumina-batch-inspector-header">
							<div class="lumina-batch-inspector-header__left">
								<h3 class="lumina-batch-inspector-title">{selectedItem.basename}</h3>
								<span class="lumina-batch-inspector-path">{selectedItem.path}</span>
							</div>
							<div class="lumina-batch-inspector-header__right">
								<span class="lumina-batch-status-pill is-{selectedItem.status}">
									{getStatusLabel(selectedItem.status)}
								</span>
								<button
									type="button"
									class="lumina-batch-btn-ghost"
									onclick={() => openNoteInWorkspace(selectedItem.path)}
								>
									<span class="lumina-batch-tab-icon" use:icon={"external-link"}></span>
									<span>{$tStore("batchStudio.inspector.openNoteBtn")}</span>
								</button>
							</div>
						</div>

						<div class="lumina-batch-inspector-body">
							{#if selectedItem.status === "locked"}
								<div class="lumina-batch-locked-card">
									<div class="lumina-batch-locked-card__icon" use:icon={"lock"}></div>
									<h4 class="lumina-batch-locked-card__title">
										{$tStore("batchStudio.proInspectorTitle")}
									</h4>
									<p class="lumina-batch-locked-card__desc">
										{$tStore("batchStudio.proInspectorDesc", {
											free: FREE_MAX_BATCH_FILES,
											locked: counts.locked,
										})}
									</p>
									<button
										type="button"
										class="mod-cta"
										onclick={() => openProUpgradeModal(plugin.app, "batch-studio")}
									>
										{$tStore("batchStudio.proInspectorCta")}
									</button>
								</div>
							{:else if selectedItem.status === "failed"}
								<div class="lumina-batch-error-box">
									<strong>{$tStore("batchStudio.inspector.errorTitle")}</strong>
									<p>{selectedItem.errorMessage ?? ""}</p>
								</div>
							{:else if selectedItem.status === "skipped" || !selectedItem.proposed}
								<div class="lumina-batch-empty is-compact">
									<p>{$tStore("batchStudio.inspector.noChanges")}</p>
								</div>
							{:else if selectedItem.proposed.kind === "frontmatter"}
								{#if selectedItem.proposed.customFmKey}
									<div class="lumina-batch-fm-block">
										<div class="lumina-batch-fm-block__title">
											{$tStore("batchStudio.inspector.customKeyLabel", {
												key: selectedItem.proposed.customFmKey,
											})}
										</div>
										<div class="lumina-batch-compare-grid">
											<div class="lumina-batch-compare-col">
												<div class="lumina-batch-compare-label">
													{$tStore("batchStudio.inspector.beforeLabel")}
												</div>
												<div class="lumina-batch-compare-readonly">
													{selectedItem.proposed.beforeCustomFmVal || "—"}
												</div>
											</div>
											<div class="lumina-batch-compare-col">
												<div class="lumina-batch-compare-label">
													{$tStore("batchStudio.inspector.afterLabel")}
												</div>
												<textarea
													class="lumina-batch-textarea"
													rows="4"
													disabled={selectedItem.status !== "staged"}
													value={selectedItem.proposed.afterCustomFmVal ?? ""}
													oninput={(e) =>
														controller.updateProposedFrontmatter(selectedItem.path, {
															afterCustomFmVal: (
																e.currentTarget as HTMLTextAreaElement
															).value,
														})}
												></textarea>
											</div>
										</div>
									</div>
								{:else}
									<!-- 태그 비교 및 인라인 편집 -->
									{#if selectedItem.proposed.afterTags !== undefined}
										<div class="lumina-batch-fm-block">
											<div class="lumina-batch-fm-block__title">
												{$tStore("batchStudio.inspector.tagsLabel")}
											</div>
											<div class="lumina-batch-compare-grid">
												<div class="lumina-batch-compare-col">
													<div class="lumina-batch-compare-label">
														{$tStore("batchStudio.inspector.beforeLabel")}
													</div>
													<div class="lumina-batch-tag-list">
														{#if (selectedItem.proposed.beforeTags?.length ?? 0) === 0}
															<span class="lumina-batch-muted">—</span>
														{:else}
															{#each selectedItem.proposed.beforeTags ?? [] as tag (tag)}
																<span class="lumina-batch-tag-pill is-before">
																	#{tag}
																</span>
															{/each}
														{/if}
													</div>
												</div>
												<div class="lumina-batch-compare-col">
													<div class="lumina-batch-compare-label">
														{$tStore("batchStudio.inspector.afterLabel")}
													</div>
													<div class="lumina-batch-tag-list">
														{#each selectedItem.proposed.afterTags as tag (tag)}
															<span class="lumina-batch-tag-pill is-editable">
																<span>#{tag}</span>
																{#if selectedItem.status === "staged"}
																	<button
																		type="button"
																		class="lumina-batch-tag-remove"
																		aria-label={$tStore(
																			"batchStudio.inspector.removeTagAria",
																			{ tag },
																		)}
																		onclick={() => handleRemoveTag(selectedItem, tag)}
																	>
																		×
																	</button>
																{/if}
															</span>
														{/each}
													</div>
													{#if selectedItem.status === "staged"}
														<div class="lumina-batch-tag-add">
															<input
																type="text"
																class="lumina-batch-input"
																placeholder={$tStore(
																	"batchStudio.inspector.addTagPlaceholder",
																)}
																bind:value={newTagInput}
																onkeydown={(e) => {
																	if (e.key === "Enter") {
																		e.preventDefault();
																		handleAddTag(selectedItem);
																	}
																}}
															/>
															<button
																type="button"
																class="lumina-batch-btn"
																onclick={() => handleAddTag(selectedItem)}
															>
																{$tStore("batchStudio.inspector.addTagBtn")}
															</button>
														</div>
													{/if}
												</div>
											</div>
										</div>
									{/if}

									<!-- 한 줄 요약(description) 비교 및 인라인 편집 -->
									{#if selectedItem.proposed.afterDescription !== undefined}
										<div class="lumina-batch-fm-block">
											<div class="lumina-batch-fm-block__title">
												{$tStore("batchStudio.inspector.descriptionLabel")}
											</div>
											<div class="lumina-batch-compare-grid">
												<div class="lumina-batch-compare-col">
													<div class="lumina-batch-compare-label">
														{$tStore("batchStudio.inspector.beforeLabel")}
													</div>
													<div class="lumina-batch-compare-readonly">
														{selectedItem.proposed.beforeDescription || "—"}
													</div>
												</div>
												<div class="lumina-batch-compare-col">
													<div class="lumina-batch-compare-label">
														{$tStore("batchStudio.inspector.afterLabel")}
													</div>
													<textarea
														class="lumina-batch-textarea"
														rows="3"
														disabled={selectedItem.status !== "staged"}
														value={selectedItem.proposed.afterDescription ?? ""}
														oninput={(e) =>
															controller.updateProposedFrontmatter(
																selectedItem.path,
																{
																	afterDescription: (
																		e.currentTarget as HTMLTextAreaElement
																	).value,
																},
															)}
													></textarea>
												</div>
											</div>
										</div>
									{/if}
								{/if}
							{:else if selectedItem.proposed.kind === "content"}
								<!-- 본문 변경 인라인 Diff 뷰 -->
								<div class="lumina-batch-diff-preview">
									{#each selectedLineDiff as line, idx (idx)}
										<div class="lumina-batch-diff-line is-{line.type}">
											<span class="lumina-batch-diff-prefix">
												{line.type === "added" ? "+" : line.type === "removed" ? "-" : " "}
											</span>
											<span class="lumina-batch-diff-text">{line.text}</span>
										</div>
									{/each}
								</div>
							{/if}
						</div>

						<!-- 하단 개별(Auto-advance) + 일괄 하이브리드 액션 바 -->
						<footer class="lumina-batch-inspector-footer">
							<div class="lumina-batch-inspector-footer__single">
								{#if selectedItem.status === "staged"}
									<button
										type="button"
										class="lumina-batch-btn"
										onclick={() => controller.rejectSingleItem(selectedItem.path)}
									>
										<span class="lumina-batch-tab-icon" use:icon={"x"}></span>
										<span>{$tStore("batchStudio.inspector.rejectBtn")}</span>
									</button>
									<button
										type="button"
										class="mod-cta"
										onclick={() => void controller.applySingleItem(selectedItem.path)}
									>
										<span class="lumina-batch-tab-icon" use:icon={"check"}></span>
										<span>{$tStore("batchStudio.inspector.acceptSingleBtn")}</span>
									</button>
								{/if}
							</div>

							<div class="lumina-batch-inspector-footer__bulk">
								{#if counts.selectedStaged > 0}
									<button
										type="button"
										class="mod-cta lumina-batch-bulk-apply-btn"
										class:is-locked={!$isProBatch}
										title={!$isProBatch ? $tStore("batchStudio.proBulkApplyNotice") : undefined}
										onclick={() => void controller.applyAllSelectedStaged()}
									>
										<span class="lumina-batch-tab-icon" use:icon={"check-check"}></span>
										<span>
											{$tStore("batchStudio.inspector.acceptAllSelectedBtn", {
												count: counts.selectedStaged,
											})}
											{#if !$isProBatch} 🔒{/if}
										</span>
									</button>
								{/if}
							</div>
						</footer>
					{/if}
				</div>
			</section>
		{/if}
	{/if}
</div>

<style>
	.lumina-batch-studio {
		display: flex;
		flex-direction: column;
		height: 100%;
		overflow: hidden;
		background: var(--background-primary);
		color: var(--text-normal);
		font-size: 13px;
	}

	.lumina-batch-header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		flex-shrink: 0;
	}

	.lumina-batch-brand {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.lumina-batch-brand__icon {
		display: inline-flex;
		color: var(--interactive-accent);
	}

	.lumina-batch-brand__title {
		margin: 0;
		font-size: 15px;
		font-weight: 600;
	}

	.lumina-batch-pro-badge {
		padding: 1px 6px;
		border-radius: 999px;
		font-size: 10px;
		font-weight: 700;
		letter-spacing: 0.04em;
		background: var(--interactive-accent);
		color: var(--text-on-accent);
	}

	.lumina-batch-recipes,
	.lumina-batch-main-tabs {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}

	.lumina-batch-recipe-tab,
	.lumina-batch-main-tab {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 10px;
		border-radius: 6px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		color: var(--text-muted);
		font-size: 12px;
		cursor: pointer;
	}

	.lumina-batch-recipe-tab.is-active,
	.lumina-batch-main-tab.is-active {
		border-color: var(--interactive-accent);
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		font-weight: 600;
	}

	.lumina-batch-recipe-tab.is-locked,
	.lumina-batch-bulk-apply-btn.is-locked {
		opacity: 0.78;
	}

	.lumina-batch-lock-tag {
		font-size: 11px;
		line-height: 1;
	}

	.lumina-batch-tab-icon {
		display: inline-flex;
		align-items: center;
		width: 14px;
		height: 14px;
	}

	.lumina-batch-tab-icon :global(svg) {
		width: 14px;
		height: 14px;
	}

	.lumina-batch-config-section {
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		flex-shrink: 0;
	}

	.lumina-batch-collapsed-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 16px;
		background: var(--background-secondary-alt);
	}

	.lumina-batch-collapsed-bar__summary {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		color: var(--text-muted);
	}

	.lumina-batch-setup-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
		gap: 12px;
		padding: 12px 16px 8px;
		max-height: 430px;
		overflow-y: auto;
	}

	.lumina-batch-card {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		background: var(--background-secondary);
	}

	.lumina-batch-card__header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.lumina-batch-card__header h3 {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
	}

	.lumina-batch-recipe-desc {
		font-size: 11px;
		color: var(--text-muted);
	}

	.lumina-batch-segmented {
		display: inline-flex;
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		overflow: hidden;
	}

	.lumina-batch-segmented button {
		padding: 4px 10px;
		border: none;
		background: var(--background-primary);
		color: var(--text-muted);
		cursor: pointer;
		font-size: 12px;
	}

	.lumina-batch-segmented button.is-active {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		font-weight: 600;
	}

	.lumina-batch-field-row {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.lumina-batch-field-split {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.lumina-batch-label {
		font-size: 12px;
		color: var(--text-muted);
		white-space: nowrap;
	}

	.lumina-batch-input,
	.lumina-batch-select,
	.lumina-batch-textarea {
		width: 100%;
		padding: 5px 8px;
		border-radius: 6px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		color: var(--text-normal);
		font-size: 12px;
	}

	.lumina-batch-input.is-short {
		width: 72px;
	}

	.lumina-batch-inline-num {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		color: var(--text-muted);
		white-space: nowrap;
	}

	.lumina-batch-checkbox-row {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
		cursor: pointer;
	}

	.lumina-batch-checkbox-inline {
		display: flex;
		flex-wrap: wrap;
		gap: 12px;
	}

	.lumina-batch-options-group {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.lumina-batch-var-chips {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 5px;
	}

	.lumina-batch-var-chips__hint {
		font-size: 11px;
		color: var(--text-muted);
	}

	.lumina-batch-chip-btn {
		padding: 2px 7px;
		border-radius: 4px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		color: var(--interactive-accent);
		font-family: var(--font-monospace);
		font-size: 11px;
		cursor: pointer;
	}

	.lumina-batch-target-summary {
		margin-top: auto;
		padding: 8px 10px;
		border-radius: 6px;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		font-size: 12px;
	}

	.lumina-batch-target-summary__main {
		font-weight: 600;
	}

	.lumina-batch-target-summary__est {
		margin-top: 2px;
		font-size: 11px;
		color: var(--text-muted);
	}

	.lumina-batch-info-banner {
		padding: 8px 10px;
		border-radius: 6px;
		background: var(--background-primary);
		border-left: 3px solid var(--interactive-accent);
		font-size: 12px;
		color: var(--text-muted);
	}

	.lumina-batch-sample-box {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding-top: 8px;
		border-top: 1px dashed var(--background-modifier-border);
	}

	.lumina-batch-sample-box__controls {
		display: flex;
		gap: 8px;
	}

	.lumina-batch-sample-preview {
		padding: 8px;
		border-radius: 6px;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		font-size: 12px;
		max-height: 120px;
		overflow-y: auto;
	}

	.lumina-batch-sample-row {
		display: flex;
		align-items: flex-start;
		gap: 6px;
		margin-bottom: 4px;
	}

	.lumina-batch-sample-key {
		font-family: var(--font-monospace);
		font-size: 11px;
		color: var(--text-muted);
	}

	.lumina-batch-sample-msg {
		font-size: 12px;
		color: var(--text-muted);
	}

	.lumina-batch-sample-msg.is-error {
		color: var(--text-error);
	}

	.lumina-batch-setup-footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 8px 16px 12px;
	}

	.lumina-batch-safety-note {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 11px;
		color: var(--text-muted);
	}

	.lumina-batch-btn,
	.lumina-batch-btn-ghost {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 10px;
		border-radius: 6px;
		font-size: 12px;
		cursor: pointer;
	}

	.lumina-batch-btn-ghost {
		border: none;
		background: transparent;
		color: var(--text-muted);
	}

	.lumina-batch-btn-ghost:hover {
		color: var(--text-normal);
		background: var(--background-modifier-hover);
	}

	.lumina-batch-start-btn {
		display: inline-flex;
		align-items: center;
		gap: 6px;
	}

	.lumina-batch-progress-bar-wrap {
		padding: 8px 16px;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		flex-shrink: 0;
	}

	.lumina-batch-progress-meta {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 6px;
	}

	.lumina-batch-progress-meta__left,
	.lumina-batch-progress-actions {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.lumina-batch-progress-text {
		font-size: 12px;
		font-weight: 500;
	}

	.lumina-batch-rate-limit {
		font-size: 11px;
		color: var(--text-warning);
	}

	.lumina-batch-progress-track {
		width: 100%;
		height: 5px;
		border-radius: 999px;
		background: var(--background-modifier-border);
		overflow: hidden;
	}

	.lumina-batch-progress-fill {
		height: 100%;
		background: var(--interactive-accent);
		transition: width 0.2s ease;
	}

	.lumina-batch-workbench {
		display: grid;
		grid-template-columns: minmax(240px, 320px) 1fr;
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	@media (max-width: 720px) {
		.lumina-batch-studio {
			overflow-y: auto;
		}

		.lumina-batch-setup-grid {
			max-height: 220px;
		}

		.lumina-batch-workbench {
			grid-template-columns: 1fr;
			grid-template-rows: 200px minmax(160px, 1fr);
			min-height: 360px;
			flex-shrink: 0;
		}

		.lumina-batch-queue-pane {
			border-right: none;
			border-bottom: 1px solid var(--background-modifier-border);
		}
	}

	/* 모바일(폰+태블릿) 배치 스튜디오 컨테이너 쿼리 기준 및 긴 경로 줄바꿈 */
	:global(body.is-mobile) .lumina-batch-studio {
		container-type: inline-size;
	}

	:global(body.is-mobile) .lumina-batch-inspector-path {
		word-break: break-all;
	}

	:global(body.is-mobile) .lumina-batch-start-btn,
	:global(body.is-mobile) .lumina-batch-bulk-apply-btn {
		flex-wrap: wrap;
		max-width: 100%;
		min-height: 30px;
		height: auto;
	}

	/* 모바일 Obsidian 기본 버튼/입력 높이(--input-height)로 인한 공간 낭비 방지: 컴팩트 높이 적용 */
	:global(body.is-mobile) .lumina-batch-studio button {
		height: auto;
		min-height: 28px;
		box-shadow: none;
	}

	:global(body.is-mobile) .lumina-batch-recipe-tab,
	:global(body.is-mobile) .lumina-batch-main-tab,
	:global(body.is-mobile) .lumina-batch-filter-tab,
	:global(body.is-mobile) .lumina-batch-btn,
	:global(body.is-mobile) .lumina-batch-btn-ghost,
	:global(body.is-mobile) .lumina-batch-chip-btn {
		padding: 4px 10px;
		line-height: 1.2;
	}

	:global(body.is-mobile) .lumina-batch-segmented button {
		padding: 3px 10px;
		line-height: 1.2;
	}

	:global(body.is-mobile) .lumina-batch-studio input:not([type="checkbox"]):not([type="radio"]):not([type="range"]),
	:global(body.is-mobile) .lumina-batch-studio select {
		height: auto;
		min-height: 28px;
		padding-top: 3px;
		padding-bottom: 3px;
	}

	@media (max-width: 720px) {
		:global(body.is-mobile) .lumina-batch-studio {
			overflow-y: auto;
		}
	}

	/* 좁은 배치 스튜디오(폰·태블릿 분할 창 <= 720px)에서만 1열 스택 및 줄바꿈 적용 */
	@container (max-width: 720px) {
		:global(body.is-mobile) .lumina-batch-studio {
			overflow-y: auto;
		}

		:global(body.is-mobile) .lumina-batch-compare-grid {
			grid-template-columns: 1fr;
		}

		:global(body.is-mobile) .lumina-batch-setup-grid {
			max-height: 220px;
		}

		:global(body.is-mobile) .lumina-batch-workbench {
			grid-template-columns: 1fr;
			grid-template-rows: 200px minmax(160px, 1fr);
			min-height: 360px;
			flex-shrink: 0;
		}

		:global(body.is-mobile) .lumina-batch-queue-pane {
			border-right: none;
			border-bottom: 1px solid var(--background-modifier-border);
		}

		:global(body.is-mobile) .lumina-batch-field-row,
		:global(body.is-mobile) .lumina-batch-field-split,
		:global(body.is-mobile) .lumina-batch-setup-footer,
		:global(body.is-mobile) .lumina-batch-progress-meta,
		:global(body.is-mobile) .lumina-batch-inspector-header,
		:global(body.is-mobile) .lumina-batch-inspector-footer,
		:global(body.is-mobile) .lumina-batch-confirm-inline {
			flex-wrap: wrap;
		}

		:global(body.is-mobile) .lumina-batch-locked-card {
			padding: 18px 14px;
		}
	}

	.lumina-batch-queue-pane {
		display: flex;
		flex-direction: column;
		border-right: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		min-height: 0;
	}

	.lumina-batch-queue-filters {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		padding: 8px;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.lumina-batch-filter-tab {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 3px 7px;
		border-radius: 5px;
		border: 1px solid transparent;
		background: transparent;
		color: var(--text-muted);
		font-size: 11px;
		cursor: pointer;
	}

	.lumina-batch-filter-tab.is-active {
		background: var(--background-primary);
		border-color: var(--background-modifier-border);
		color: var(--text-normal);
		font-weight: 600;
	}

	.lumina-batch-filter-tab__cnt {
		opacity: 0.75;
	}

	.lumina-batch-queue-bulkbar {
		padding: 4px 8px;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.lumina-batch-queue-list {
		flex: 1;
		overflow-y: auto;
		padding: 4px;
	}

	.lumina-batch-queue-item {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 7px 8px;
		border-radius: 6px;
		cursor: pointer;
	}

	.lumina-batch-queue-item:hover {
		background: var(--background-modifier-hover);
	}

	.lumina-batch-queue-item.is-selected {
		background: var(--background-primary);
		outline: 1px solid var(--interactive-accent);
	}

	.lumina-batch-queue-item.is-locked {
		opacity: 0.65;
	}

	.lumina-batch-queue-item__icon {
		display: inline-flex;
		flex-shrink: 0;
		width: 14px;
		height: 14px;
	}

	.lumina-batch-queue-item__icon :global(svg) {
		width: 14px;
		height: 14px;
	}

	.lumina-batch-queue-item__icon.is-staged {
		color: var(--interactive-accent);
	}
	.lumina-batch-queue-item__icon.is-applied {
		color: var(--color-green);
	}
	.lumina-batch-queue-item__icon.is-failed {
		color: var(--text-error);
	}
	.lumina-batch-queue-item__icon.is-locked {
		color: var(--text-muted);
	}

	.lumina-batch-queue-item__body {
		flex: 1;
		min-width: 0;
	}

	.lumina-batch-queue-item__name {
		font-size: 12px;
		font-weight: 500;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.lumina-batch-queue-item__path {
		font-size: 10px;
		color: var(--text-muted);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.lumina-batch-queue-item__badge {
		padding: 1px 5px;
		border-radius: 4px;
		font-size: 10px;
		background: var(--background-primary-alt);
		color: var(--text-muted);
		white-space: nowrap;
	}

	.lumina-batch-queue-item__badge.is-pro {
		background: color-mix(in srgb, var(--interactive-accent) 16%, transparent);
		color: var(--interactive-accent);
		font-weight: 700;
	}

	.lumina-batch-locked-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		gap: 10px;
		padding: 36px 24px;
		border-radius: 10px;
		border: 1px dashed var(--background-modifier-border);
		background: var(--background-secondary);
		margin: auto 0;
	}

	.lumina-batch-locked-card__icon {
		display: inline-flex;
		color: var(--interactive-accent);
	}

	.lumina-batch-locked-card__icon :global(svg) {
		width: 24px;
		height: 24px;
	}

	.lumina-batch-locked-card__title {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
		color: var(--text-normal);
	}

	.lumina-batch-locked-card__desc {
		margin: 0;
		max-width: 420px;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--text-muted);
	}

	.lumina-batch-inspector-pane {
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--background-primary);
	}

	.lumina-batch-inspector-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--background-modifier-border);
	}

	.lumina-batch-inspector-title {
		margin: 0;
		font-size: 14px;
		font-weight: 600;
	}

	.lumina-batch-inspector-path {
		font-size: 11px;
		color: var(--text-muted);
	}

	.lumina-batch-inspector-header__right {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.lumina-batch-inspector-body {
		flex: 1;
		overflow-y: auto;
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
	}

	.lumina-batch-fm-block {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		background: var(--background-secondary);
	}

	.lumina-batch-fm-block__title {
		font-size: 12px;
		font-weight: 600;
	}

	.lumina-batch-compare-grid {
		display: grid;
		grid-template-columns: 1fr 1fr;
		gap: 12px;
	}

	@media (max-width: 900px) {
		.lumina-batch-compare-grid {
			grid-template-columns: 1fr;
		}
	}

	.lumina-batch-compare-col {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.lumina-batch-compare-label {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
	}

	.lumina-batch-compare-readonly {
		padding: 8px;
		border-radius: 6px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		font-size: 12px;
		color: var(--text-muted);
		white-space: pre-wrap;
	}

	.lumina-batch-tag-list {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.lumina-batch-tag-pill {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		border-radius: 999px;
		background: rgba(var(--color-accent-rgb, 139, 92, 246), 0.14);
		color: var(--interactive-accent);
		font-size: 12px;
		font-weight: 500;
	}

	.lumina-batch-tag-pill.is-before {
		background: var(--background-primary);
		color: var(--text-muted);
		border: 1px solid var(--background-modifier-border);
	}

	.lumina-batch-tag-remove {
		border: none;
		background: transparent;
		color: inherit;
		cursor: pointer;
		padding: 0 2px;
		font-size: 13px;
		line-height: 1;
	}

	.lumina-batch-tag-add {
		display: flex;
		gap: 6px;
		margin-top: 4px;
	}

	.lumina-batch-diff-preview {
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		background: var(--background-secondary);
		font-family: var(--font-monospace);
		font-size: 12px;
		line-height: 1.5;
		overflow-x: auto;
	}

	.lumina-batch-diff-line {
		display: flex;
		gap: 8px;
		padding: 1px 10px;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.lumina-batch-diff-line.is-added {
		background: rgba(16, 185, 129, 0.15);
		color: var(--text-normal);
	}

	.lumina-batch-diff-line.is-removed {
		background: rgba(239, 68, 68, 0.15);
		color: var(--text-muted);
		text-decoration: line-through;
	}

	.lumina-batch-diff-prefix {
		user-select: none;
		opacity: 0.7;
		width: 12px;
		flex-shrink: 0;
	}

	.lumina-batch-inspector-footer {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		padding: 10px 16px;
		border-top: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
	}

	.lumina-batch-inspector-footer__single,
	.lumina-batch-inspector-footer__bulk {
		display: flex;
		align-items: center;
		gap: 8px;
	}

	.lumina-batch-status-pill {
		padding: 2px 8px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 600;
		background: var(--background-primary-alt);
		color: var(--text-muted);
	}

	.lumina-batch-status-pill.is-running,
	.lumina-batch-status-pill.is-staged {
		background: rgba(var(--color-accent-rgb, 139, 92, 246), 0.15);
		color: var(--interactive-accent);
	}

	.lumina-batch-status-pill.is-applied,
	.lumina-batch-status-pill.is-completed {
		background: rgba(16, 185, 129, 0.15);
		color: var(--color-green);
	}

	.lumina-batch-status-pill.is-failed {
		background: rgba(239, 68, 68, 0.15);
		color: var(--text-error);
	}

	.lumina-batch-status-pill.is-locked {
		background: color-mix(in srgb, var(--interactive-accent) 14%, transparent);
		color: var(--interactive-accent);
	}

	.lumina-batch-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 8px;
		padding: 40px 20px;
		text-align: center;
		color: var(--text-muted);
		flex: 1;
	}

	.lumina-batch-empty__icon {
		display: inline-flex;
		opacity: 0.5;
	}

	.lumina-batch-empty__icon :global(svg) {
		width: 28px;
		height: 28px;
	}

	.lumina-batch-error-box {
		padding: 12px;
		border-radius: 8px;
		border: 1px solid var(--text-error);
		background: rgba(239, 68, 68, 0.08);
		color: var(--text-error);
	}

	.lumina-batch-history-pane {
		flex: 1;
		overflow-y: auto;
		padding: 16px;
	}

	.lumina-batch-history-list {
		display: flex;
		flex-direction: column;
		gap: 12px;
		max-width: 880px;
		margin: 0 auto;
	}

	.lumina-batch-history-card {
		padding: 12px 14px;
		border-radius: 8px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.lumina-batch-history-card__top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
	}

	.lumina-batch-history-card__title {
		font-weight: 600;
		font-size: 13px;
	}

	.lumina-batch-history-card__meta {
		font-size: 11px;
		color: var(--text-muted);
		margin-top: 2px;
	}

	.lumina-batch-history-card__files {
		display: flex;
		flex-wrap: wrap;
		gap: 5px;
	}

	.lumina-batch-file-chip {
		padding: 2px 7px;
		border-radius: 4px;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
		font-size: 11px;
		color: var(--text-muted);
	}

	.lumina-batch-confirm-inline {
		display: flex;
		align-items: center;
		gap: 6px;
		font-size: 12px;
	}

	.lumina-batch-confirm-inline__text {
		color: var(--text-warning);
	}

	.lumina-batch-muted {
		color: var(--text-muted);
		font-size: 12px;
	}
</style>
