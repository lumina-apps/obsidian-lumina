<script lang="ts">
	import { Notice, Platform } from "obsidian";
	import { untrack } from "svelte";
	import type LuminaPlugin from "../../../main";
	import {
		batchStore,
		createDefaultFolderMoveConfig,
		patchBatchState,
	} from "../../../core/store/batchStore";
	import { batchWatchStore } from "../../../core/store/batchWatchStore";
	import { hasProFeature } from "../../../core/store/entitlementStore";
	import { activeProject } from "../../../core/store/projectStore";
	import {
		settingsStore,
		syncSettingsStore,
		verifiedProviders,
	} from "../../../core/store/settingsStore";
	import { tStore } from "../../../shared/locales/index";
	import type {
		CustomOutputMode,
		FrontmatterMergeMode,
	} from "../../../shared/types/batch.types";
	import type {
		FolderMoveMode,
		FolderWatchRule,
		MoveConflictPolicy,
		WatchContentRecipeId,
		WatchExecutionMode,
		WatchTriggerMode,
	} from "../../../shared/types/batchWatch.types";
	import { icon } from "../../../shared/utils/iconAction";
	import {
		parseProviderModelValue,
		toProviderModelValue,
	} from "../../../shared/utils/modelUtils";
	import {
		notifyProFeatureLocked,
		openProUpgradeModal,
	} from "../../../shared/utils/proUpgradeModal";
	import { computeLineDiff, listVaultFolders } from "../batchTargetResolver";
	import { getBatchEligibleProviders } from "../recipes/batchRecipes";
	import { sanitizeFolderPath, validateMoveDestination } from "../watch/folderMover";

	let { plugin }: { plugin: LuminaPlugin } = $props();

	const isProBatch = hasProFeature("batch-studio");
	const isMobile = typeof Platform !== "undefined" && Boolean(Platform?.isMobile);

	const watchState = $derived($batchWatchStore);
	const settingsState = $derived($settingsStore);
	const rules = $derived(settingsState?.batchWatch?.rules ?? []);
	const dailyCap = $derived(settingsState?.batchWatch?.dailyMaxItems ?? 30);
	const burstLimit = $derived(settingsState?.batchWatch?.burstLimit ?? 8);
	const vaultFolders = $derived(listVaultFolders(plugin.app));

	const eligibleProviders = $derived(getBatchEligibleProviders($verifiedProviders));
	const modelOptions = $derived.by(() => {
		const opts: Array<{ value: string; label: string }> = [];
		for (const p of eligibleProviders) {
			for (const m of p.availableModels) {
				opts.push({
					value: toProviderModelValue(p.id, m),
					label: `${p.type} · ${m}`,
				});
			}
		}
		return opts;
	});

	// ── 규칙 편집기 폼 상태 ───────────────────────────────────────────────────
	let editorOpen = $state(false);
	let editingRuleId = $state<string | null>(null);
	let draftRule = $state<FolderWatchRule>(createBlankRule());
	let formError = $state<string | null>(null);

	let newTagMapTag = $state("");
	let newTagMapFolder = $state("");
	let newAiCandidateFolder = $state("");

	function createBlankRule(): FolderWatchRule {
		return {
			id: crypto.randomUUID(),
			name: "",
			enabled: true,
			sourceFolder: "",
			includeSubfolders: false,
			tagFilter: "",
			minContentLength: 50,
			skipIfAlreadyHasTarget: true,
			triggerMode: "on-create",
			debounceSec: 15,
			intervalMin: 15,
			recipes: ["frontmatter"],
			recipeOptions: {
				fmMergeMode: "empty-only",
				generateTags: true,
				generateDescription: true,
				calloutTitle: "Summary",
				customPrompt: "",
				customOutputMode: "frontmatter-key",
				customFrontmatterKey: "ai_summary",
				providerId: "",
				modelId: "",
			},
			moveAction: createDefaultFolderMoveConfig("none"),
			executionMode: "auto-stage",
		};
	}

	// 작업 공간에서 "자동감시 규칙으로 저장"으로 넘어온 초안이 있으면 편집기를 즉시 엽니다.
	$effect(() => {
		const incoming = $batchStore.draftWatchRule;
		if (!incoming) return;
		untrack(() => {
			const base = createBlankRule();
			draftRule = {
				...base,
				...incoming,
				id: crypto.randomUUID(),
				recipes: incoming.recipes ? [...incoming.recipes] : base.recipes,
				recipeOptions: {
					...base.recipeOptions,
					...(incoming.recipeOptions ?? {}),
				},
				moveAction: {
					...base.moveAction,
					...(incoming.moveAction ?? {}),
					tagMappings: (incoming.moveAction?.tagMappings ?? []).map((m) => ({ ...m })),
					aiCandidateFolders: [...(incoming.moveAction?.aiCandidateFolders ?? [])],
				},
			};
			editingRuleId = null;
			formError = null;
			editorOpen = true;
			patchBatchState({ draftWatchRule: null });
		});
	});

	// ── 설정 저장 및 매니저 동기화 ─────────────────────────────────────────────
	async function persistWatchSettings(
		nextRules: FolderWatchRule[],
		extra?: { dailyMaxItems?: number; burstLimit?: number },
	): Promise<void> {
		const prev = plugin.settings.batchWatch ?? {
			rules: [],
			dailyMaxItems: 30,
			burstLimit: 8,
			showStatusBar: true,
		};
		plugin.settings.batchWatch = {
			...prev,
			...extra,
			rules: nextRules,
		};
		await plugin.saveSettings();
		syncSettingsStore(plugin.settings);
		const manager = await plugin.ensureFolderWatchManager();
		manager?.syncWatchers();
	}

	async function handleDeviceToggle(checked: boolean): Promise<void> {
		if (!$isProBatch) {
			notifyProFeatureLocked(plugin.app, "batch-studio", $tStore("batchStudio.watch.proNotice"));
			return;
		}
		const manager = await plugin.ensureFolderWatchManager();
		manager?.setDeviceEnabled(checked);
	}

	function openNewRuleEditor(): void {
		if (!$isProBatch) {
			notifyProFeatureLocked(plugin.app, "batch-studio", $tStore("batchStudio.watch.proNotice"));
			return;
		}
		editingRuleId = null;
		draftRule = createBlankRule();
		formError = null;
		editorOpen = true;
	}

	function openEditRuleEditor(rule: FolderWatchRule): void {
		if (!$isProBatch) {
			notifyProFeatureLocked(plugin.app, "batch-studio", $tStore("batchStudio.watch.proNotice"));
			return;
		}
		editingRuleId = rule.id;
		draftRule = {
			...rule,
			recipes: [...rule.recipes],
			recipeOptions: { ...rule.recipeOptions },
			moveAction: {
				...rule.moveAction,
				tagMappings: rule.moveAction.tagMappings.map((m) => ({ ...m })),
				aiCandidateFolders: [...rule.moveAction.aiCandidateFolders],
			},
		};
		formError = null;
		editorOpen = true;
	}

	function toggleRecipeInDraft(recipeId: WatchContentRecipeId): void {
		if (draftRule.recipes.includes(recipeId)) {
			draftRule.recipes = draftRule.recipes.filter((r) => r !== recipeId);
		} else {
			draftRule.recipes = [...draftRule.recipes, recipeId];
		}
	}

	function addTagMapping(): void {
		const tag = newTagMapTag.trim().replace(/^#+/, "");
		const target = sanitizeFolderPath(newTagMapFolder);
		if (!tag || !target) return;
		draftRule.moveAction.tagMappings = [
			...draftRule.moveAction.tagMappings,
			{ tag, targetFolder: target },
		];
		newTagMapTag = "";
		newTagMapFolder = "";
	}

	function removeTagMapping(idx: number): void {
		draftRule.moveAction.tagMappings = draftRule.moveAction.tagMappings.filter(
			(_, i) => i !== idx,
		);
	}

	function addAiCandidate(): void {
		const norm = sanitizeFolderPath(newAiCandidateFolder);
		if (!norm) return;
		if (!draftRule.moveAction.aiCandidateFolders.some((c) => c.toLowerCase() === norm.toLowerCase())) {
			draftRule.moveAction.aiCandidateFolders = [
				...draftRule.moveAction.aiCandidateFolders,
				norm,
			];
		}
		newAiCandidateFolder = "";
	}

	function removeAiCandidate(folder: string): void {
		draftRule.moveAction.aiCandidateFolders = draftRule.moveAction.aiCandidateFolders.filter(
			(f) => f !== folder,
		);
	}

	async function saveDraftRule(): Promise<void> {
		if (!$isProBatch) {
			notifyProFeatureLocked(plugin.app, "batch-studio", $tStore("batchStudio.watch.proNotice"));
			return;
		}

		const excludedPaths = $activeProject?.ragExcludedPaths ?? [];
		const srcCheck = validateMoveDestination(draftRule.sourceFolder, {
			excludedPaths,
			configDir: plugin.app.vault?.configDir,
		});
		if (!srcCheck.valid) {
			formError = $tStore("batchStudio.watch.validationSourceRequired");
			return;
		}

		if (draftRule.recipes.length === 0 && draftRule.moveAction.mode === "none") {
			formError = $tStore("batchStudio.watch.validationActionRequired");
			return;
		}

		const loopOpts = {
			excludedPaths,
			configDir: plugin.app.vault?.configDir,
			disallowedSourceFolder: srcCheck.normalizedFolder,
			includeSubfolders: draftRule.includeSubfolders,
		};

		if (draftRule.moveAction.mode === "fixed") {
			const destCheck = validateMoveDestination(draftRule.moveAction.fixedTargetFolder, loopOpts);
			if (!destCheck.valid) {
				formError =
					destCheck.reason === "self-loop-folder"
						? $tStore("batchStudio.watch.validationSelfLoop")
						: $tStore("batchStudio.options.moveNoTargetNotice");
				return;
			}
			draftRule.moveAction.fixedTargetFolder = destCheck.normalizedFolder;
		} else if (draftRule.moveAction.mode === "by-tag") {
			if (
				draftRule.moveAction.tagMappings.length === 0 &&
				!draftRule.moveAction.fallbackFolder.trim()
			) {
				formError = $tStore("batchStudio.options.moveNoRulesNotice");
				return;
			}
			for (const mapping of draftRule.moveAction.tagMappings) {
				const check = validateMoveDestination(mapping.targetFolder, loopOpts);
				if (!check.valid && check.reason === "self-loop-folder") {
					formError = $tStore("batchStudio.watch.validationSelfLoop");
					return;
				}
			}
		} else if (draftRule.moveAction.mode === "ai-route") {
			if (draftRule.moveAction.aiCandidateFolders.length === 0) {
				formError = $tStore("batchStudio.options.moveNoCandidatesNotice");
				return;
			}
			for (const cand of draftRule.moveAction.aiCandidateFolders) {
				const check = validateMoveDestination(cand, loopOpts);
				if (!check.valid && check.reason === "self-loop-folder") {
					formError = $tStore("batchStudio.watch.validationSelfLoop");
					return;
				}
			}
		}

		if (draftRule.moveAction.fallbackFolder.trim()) {
			const fbCheck = validateMoveDestination(draftRule.moveAction.fallbackFolder, loopOpts);
			if (!fbCheck.valid && fbCheck.reason === "self-loop-folder") {
				formError = $tStore("batchStudio.watch.validationSelfLoop");
				return;
			}
		}

		const normalizedRule: FolderWatchRule = {
			...draftRule,
			name: draftRule.name.trim() || srcCheck.normalizedFolder,
			sourceFolder: srcCheck.normalizedFolder,
			debounceSec: Math.max(3, Number(draftRule.debounceSec) || 15),
			intervalMin: Math.max(1, Number(draftRule.intervalMin) || 15),
			minContentLength: Math.max(0, Number(draftRule.minContentLength) || 0),
		};

		const nextRules = editingRuleId
			? rules.map((r) => (r.id === editingRuleId ? normalizedRule : r))
			: [...rules, normalizedRule];

		await persistWatchSettings(nextRules);
		formError = null;
		editorOpen = false;
		editingRuleId = null;
	}

	async function toggleRuleEnabled(ruleId: string, enabled: boolean): Promise<void> {
		if (!$isProBatch) {
			notifyProFeatureLocked(plugin.app, "batch-studio", $tStore("batchStudio.watch.proNotice"));
			return;
		}
		const next = rules.map((r) => (r.id === ruleId ? { ...r, enabled } : r));
		await persistWatchSettings(next);
	}

	async function deleteRule(ruleId: string): Promise<void> {
		const next = rules.filter((r) => r.id !== ruleId);
		await persistWatchSettings(next);
		if (editingRuleId === ruleId) {
			editorOpen = false;
			editingRuleId = null;
		}
	}

	async function handleRunRuleNow(rule: FolderWatchRule): Promise<void> {
		if (!$isProBatch) {
			notifyProFeatureLocked(plugin.app, "batch-studio", $tStore("batchStudio.watch.proNotice"));
			return;
		}
		const manager = await plugin.ensureFolderWatchManager();
		if (!manager) return;
		const count = await manager.runRuleNow(rule.id);
		new Notice($tStore("batchStudio.watch.runNowNotice", { count, name: rule.name }));
	}

	async function handleApproveStaged(stagedId: string): Promise<void> {
		const manager = await plugin.ensureFolderWatchManager();
		await manager?.approveStagedItem(stagedId);
	}

	async function handleApproveAll(): Promise<void> {
		const manager = await plugin.ensureFolderWatchManager();
		await manager?.approveAllStaged();
	}

	function handleRejectStaged(stagedId: string): void {
		plugin.folderWatchManager?.rejectStagedItem(stagedId);
	}

	function getRecipeShortLabel(recipeId: WatchContentRecipeId): string {
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

	function getMoveSummary(rule: FolderWatchRule): string {
		switch (rule.moveAction.mode) {
			case "none":
				return $tStore("batchStudio.watch.moveModeNone");
			case "fixed":
				return `→ ${rule.moveAction.fixedTargetFolder}`;
			case "by-tag":
				return `${$tStore("batchStudio.options.moveModeByTag")} (${rule.moveAction.tagMappings.length})`;
			case "ai-route":
				return `${$tStore("batchStudio.options.moveModeAiRoute")} (${rule.moveAction.aiCandidateFolders.length})`;
		}
	}

	function getLogStatusLabel(status: string): string {
		switch (status) {
			case "staged":
				return $tStore("batchStudio.watch.statusStaged");
			case "applied":
				return $tStore("batchStudio.watch.statusApplied");
			case "moved":
				return $tStore("batchStudio.watch.statusMoved");
			case "skipped":
				return $tStore("batchStudio.watch.statusSkipped");
			case "failed":
				return $tStore("batchStudio.watch.statusFailed");
			case "burst-paused":
				return $tStore("batchStudio.watch.statusBurstPaused");
			case "daily-cap":
				return $tStore("batchStudio.watch.statusDailyCap");
			default:
				return status;
		}
	}

	const draftModelValue = $derived(
		draftRule.recipeOptions.providerId && draftRule.recipeOptions.modelId
			? toProviderModelValue(draftRule.recipeOptions.providerId, draftRule.recipeOptions.modelId)
			: "",
	);
</script>

<section class="lumina-watch-pane">
	<!-- 상단 기기 제어 바 -->
	<div class="lumina-watch-topbar">
		<div class="lumina-watch-topbar__left">
			<label class="lumina-watch-switch-row">
				<input
					type="checkbox"
					checked={watchState.deviceWatchEnabled}
					disabled={!$isProBatch}
					onchange={(e) =>
						void handleDeviceToggle((e.currentTarget as HTMLInputElement).checked)}
				/>
				<span class="lumina-watch-switch-title">
					{$tStore("batchStudio.watch.deviceToggleLabel")}
				</span>
			</label>
			<div class="lumina-watch-subtext">
				{$tStore("batchStudio.watch.deviceToggleDesc")}
				{#if isMobile}
					· {$tStore("batchStudio.watch.mobileHint")}
				{/if}
			</div>
		</div>

		<div class="lumina-watch-topbar__right">
			<span class="lumina-watch-pill">
				{$tStore("batchStudio.watch.dailyUsage", {
					count: watchState.dailyProcessedCount,
					limit: dailyCap,
				})}
			</span>
			{#if $isProBatch}
				<label class="lumina-watch-mini-num">
					<span>{$tStore("batchStudio.watch.dailyCapLabel")}</span>
					<input
						type="number"
						min="1"
						max="500"
						value={dailyCap}
						onchange={(e) =>
							void persistWatchSettings(rules, {
								dailyMaxItems: Math.max(
									1,
									Number((e.currentTarget as HTMLInputElement).value) || 30,
								),
								burstLimit,
							})}
					/>
				</label>
				<label class="lumina-watch-mini-num">
					<span>{$tStore("batchStudio.watch.burstLimitLabel")}</span>
					<input
						type="number"
						min="2"
						max="100"
						value={burstLimit}
						onchange={(e) =>
							void persistWatchSettings(rules, {
								dailyMaxItems: dailyCap,
								burstLimit: Math.max(
									2,
									Number((e.currentTarget as HTMLInputElement).value) || 8,
								),
							})}
					/>
				</label>
			{/if}
			<button type="button" class="mod-cta" onclick={openNewRuleEditor}>
				<span class="lumina-watch-icon" use:icon={"plus"}></span>
				<span>{$tStore("batchStudio.watch.addRuleBtn")}</span>
			</button>
		</div>
	</div>

	{#if !$isProBatch}
		<!-- 무료 사용자용 Pro 안내 배너 -->
		<div class="lumina-watch-pro-card">
			<div class="lumina-watch-pro-card__icon" use:icon={"folder-sync"}></div>
			<h3>{$tStore("batchStudio.watch.proCardTitle")}</h3>
			<p>{$tStore("batchStudio.watch.proCardDesc")}</p>
			<button
				type="button"
				class="mod-cta"
				onclick={() => openProUpgradeModal(plugin.app, "batch-studio")}
			>
				{$tStore("batchStudio.watch.proCardCta")}
			</button>
		</div>
	{:else}
		<datalist id="lumina-watch-folder-list">
			{#each vaultFolders as folder (folder)}
				<option value={folder}></option>
			{/each}
		</datalist>

		{#if editorOpen}
			<!-- 규칙 추가/편집 패널 -->
			<div class="lumina-watch-editor">
				<div class="lumina-watch-editor__header">
					<h3>
						{editingRuleId
							? $tStore("batchStudio.watch.ruleEditorTitleEdit")
							: $tStore("batchStudio.watch.ruleEditorTitleNew")}
					</h3>
					<button
						type="button"
						class="lumina-watch-btn-ghost"
						onclick={() => (editorOpen = false)}
					>
						{$tStore("common.cancel")}
					</button>
				</div>

				<div class="lumina-watch-editor__grid">
					<div class="lumina-watch-field">
						<label for="lumina-watch-name">{$tStore("batchStudio.watch.ruleNameLabel")}</label>
						<input
							id="lumina-watch-name"
							type="text"
							placeholder={$tStore("batchStudio.watch.ruleNamePlaceholder")}
							bind:value={draftRule.name}
						/>
					</div>

					<div class="lumina-watch-field">
						<label for="lumina-watch-src">{$tStore("batchStudio.watch.sourceFolderLabel")}</label>
						<input
							id="lumina-watch-src"
							type="text"
							list="lumina-watch-folder-list"
							placeholder={$tStore("batchStudio.watch.sourceFolderPlaceholder")}
							bind:value={draftRule.sourceFolder}
						/>
					</div>

					<div class="lumina-watch-field-inline">
						<label class="lumina-watch-checkbox">
							<input type="checkbox" bind:checked={draftRule.includeSubfolders} />
							<span>{$tStore("batchStudio.watch.includeSubfoldersLabel")}</span>
						</label>
						<label class="lumina-watch-checkbox">
							<input type="checkbox" bind:checked={draftRule.skipIfAlreadyHasTarget} />
							<span>{$tStore("batchStudio.target.skipExistingFm")}</span>
						</label>
					</div>

					<div class="lumina-watch-field-row">
						<div class="lumina-watch-field">
							<label for="lumina-watch-trigger">{$tStore("batchStudio.watch.triggerModeLabel")}</label>
							<select
								id="lumina-watch-trigger"
								value={draftRule.triggerMode}
								onchange={(e) =>
									(draftRule.triggerMode = (e.currentTarget as HTMLSelectElement)
										.value as WatchTriggerMode)}
							>
								<option value="on-create">{$tStore("batchStudio.watch.triggerOnCreate")}</option>
								<option value="on-create-or-modify">
									{$tStore("batchStudio.watch.triggerOnCreateOrModify")}
								</option>
								<option value="interval">{$tStore("batchStudio.watch.triggerInterval")}</option>
							</select>
						</div>

						{#if draftRule.triggerMode === "interval"}
							<div class="lumina-watch-field is-narrow">
								<label for="lumina-watch-interval">{$tStore("batchStudio.watch.intervalMinLabel")}</label>
								<input
									id="lumina-watch-interval"
									type="number"
									min="1"
									bind:value={draftRule.intervalMin}
								/>
							</div>
						{:else}
							<div class="lumina-watch-field is-narrow">
								<label for="lumina-watch-debounce">{$tStore("batchStudio.watch.debounceSecLabel")}</label>
								<input
									id="lumina-watch-debounce"
									type="number"
									min="3"
									bind:value={draftRule.debounceSec}
								/>
							</div>
						{/if}

						<div class="lumina-watch-field is-narrow">
							<label for="lumina-watch-minchars">{$tStore("batchStudio.target.minCharsLabel")}</label>
							<input
								id="lumina-watch-minchars"
								type="number"
								min="0"
								step="10"
								bind:value={draftRule.minContentLength}
							/>
						</div>

						<div class="lumina-watch-field">
							<label for="lumina-watch-tagfilter">Tag Filter</label>
							<input
								id="lumina-watch-tagfilter"
								type="text"
								placeholder={$tStore("batchStudio.target.tagFilterPlaceholder")}
								bind:value={draftRule.tagFilter}
							/>
						</div>
					</div>

					<!-- 실행 레시피 다중 선택 -->
					<div class="lumina-watch-field">
						<span class="lumina-watch-label">{$tStore("batchStudio.watch.recipesLabel")}</span>
						<div class="lumina-watch-chip-group">
							{#each ["frontmatter", "summary-callout", "autolink", "custom-prompt"] as rId (rId)}
								{@const typedId = rId as WatchContentRecipeId}
								<label class="lumina-watch-chip-check">
									<input
										type="checkbox"
										checked={draftRule.recipes.includes(typedId)}
										onchange={() => toggleRecipeInDraft(typedId)}
									/>
									<span>{getRecipeShortLabel(typedId)}</span>
								</label>
							{/each}
						</div>
					</div>

					{#if draftRule.recipes.some((r) => r !== "autolink") || draftRule.moveAction.mode === "ai-route"}
						<div class="lumina-watch-field">
							<label for="lumina-watch-model">{$tStore("batchStudio.options.modelLabel")}</label>
							<select
								id="lumina-watch-model"
								value={draftModelValue}
								onchange={(e) => {
									const raw = (e.currentTarget as HTMLSelectElement).value;
									if (!raw) {
										draftRule.recipeOptions.providerId = "";
										draftRule.recipeOptions.modelId = "";
									} else {
										const parsed = parseProviderModelValue(raw);
										if (parsed) {
											draftRule.recipeOptions.providerId = parsed.providerId;
											draftRule.recipeOptions.modelId = parsed.modelId;
										}
									}
								}}
							>
								<option value="">{$tStore("batchStudio.options.modelAutoTask")}</option>
								{#each modelOptions as opt (opt.value)}
									<option value={opt.value}>{opt.label}</option>
								{/each}
							</select>
						</div>
					{/if}

					{#if draftRule.recipes.includes("frontmatter")}
						<div class="lumina-watch-subbox">
							<div class="lumina-watch-field-inline">
								<label class="lumina-watch-checkbox">
									<input type="checkbox" bind:checked={draftRule.recipeOptions.generateTags} />
									<span>{$tStore("batchStudio.options.generateTagsLabel")}</span>
								</label>
								<label class="lumina-watch-checkbox">
									<input
										type="checkbox"
										bind:checked={draftRule.recipeOptions.generateDescription}
									/>
									<span>{$tStore("batchStudio.options.generateDescriptionLabel")}</span>
								</label>
								<select
									value={draftRule.recipeOptions.fmMergeMode}
									onchange={(e) =>
										(draftRule.recipeOptions.fmMergeMode = (
											e.currentTarget as HTMLSelectElement
										).value as FrontmatterMergeMode)}
								>
									<option value="empty-only">{$tStore("batchStudio.options.fmModeEmptyOnly")}</option>
									<option value="merge">{$tStore("batchStudio.options.fmModeMerge")}</option>
									<option value="overwrite">{$tStore("batchStudio.options.fmModeOverwrite")}</option>
								</select>
							</div>
						</div>
					{/if}

					{#if draftRule.recipes.includes("summary-callout")}
						<div class="lumina-watch-field">
							<label for="lumina-watch-callout">{$tStore("batchStudio.options.calloutTitleLabel")}</label>
							<input
								id="lumina-watch-callout"
								type="text"
								placeholder={$tStore("batchStudio.options.calloutTitlePlaceholder")}
								bind:value={draftRule.recipeOptions.calloutTitle}
							/>
						</div>
					{/if}

					{#if draftRule.recipes.includes("custom-prompt")}
						<div class="lumina-watch-subbox">
							<textarea
								rows="3"
								placeholder={$tStore("batchStudio.options.customPromptPlaceholder")}
								bind:value={draftRule.recipeOptions.customPrompt}
							></textarea>
							<div class="lumina-watch-field-row">
								<select
									value={draftRule.recipeOptions.customOutputMode}
									onchange={(e) =>
										(draftRule.recipeOptions.customOutputMode = (
											e.currentTarget as HTMLSelectElement
										).value as CustomOutputMode)}
								>
									<option value="frontmatter-key">{$tStore("batchStudio.options.outputFmKey")}</option>
									<option value="prepend">{$tStore("batchStudio.options.outputPrepend")}</option>
									<option value="append">{$tStore("batchStudio.options.outputAppend")}</option>
									<option value="replace">{$tStore("batchStudio.options.outputReplace")}</option>
								</select>
								{#if draftRule.recipeOptions.customOutputMode === "frontmatter-key"}
									<input
										type="text"
										placeholder={$tStore("batchStudio.options.fmKeyPlaceholder")}
										bind:value={draftRule.recipeOptions.customFrontmatterKey}
									/>
								{/if}
							</div>
						</div>
					{/if}

					<!-- 후처리 폴더 이동 설정 -->
					<div class="lumina-watch-subbox">
						<div class="lumina-watch-field-row">
							<div class="lumina-watch-field">
								<label for="lumina-watch-movemode">{$tStore("batchStudio.watch.moveActionLabel")}</label>
								<select
									id="lumina-watch-movemode"
									value={draftRule.moveAction.mode}
									onchange={(e) =>
										(draftRule.moveAction.mode = (
											e.currentTarget as HTMLSelectElement
										).value as FolderMoveMode)}
								>
									<option value="none">{$tStore("batchStudio.watch.moveModeNone")}</option>
									<option value="fixed">{$tStore("batchStudio.options.moveModeFixed")}</option>
									<option value="by-tag">{$tStore("batchStudio.options.moveModeByTag")}</option>
									<option value="ai-route">{$tStore("batchStudio.options.moveModeAiRoute")}</option>
								</select>
							</div>

							{#if draftRule.moveAction.mode !== "none"}
								<div class="lumina-watch-field">
									<label for="lumina-watch-conflict">{$tStore("batchStudio.options.moveConflictLabel")}</label>
									<select
										id="lumina-watch-conflict"
										value={draftRule.moveAction.conflictPolicy}
										onchange={(e) =>
											(draftRule.moveAction.conflictPolicy = (
												e.currentTarget as HTMLSelectElement
											).value as MoveConflictPolicy)}
									>
										<option value="rename-suffix">
											{$tStore("batchStudio.options.moveConflictRename")}
										</option>
										<option value="skip">{$tStore("batchStudio.options.moveConflictSkip")}</option>
									</select>
								</div>
							{/if}
						</div>

						{#if draftRule.moveAction.mode === "fixed"}
							<div class="lumina-watch-field">
								<label for="lumina-watch-fixeddest">
									{$tStore("batchStudio.options.moveTargetFolderLabel")}
								</label>
								<input
									id="lumina-watch-fixeddest"
									type="text"
									list="lumina-watch-folder-list"
									placeholder={$tStore("batchStudio.options.moveTargetFolderPlaceholder")}
									bind:value={draftRule.moveAction.fixedTargetFolder}
								/>
							</div>
						{:else if draftRule.moveAction.mode === "by-tag"}
							<div class="lumina-watch-field">
								<span class="lumina-watch-label">
									{$tStore("batchStudio.options.moveTagMappingsLabel")}
								</span>
								<div class="lumina-watch-inline-add">
									<input
										type="text"
										placeholder={$tStore("batchStudio.options.moveTagPlaceholder")}
										bind:value={newTagMapTag}
									/>
									<input
										type="text"
										list="lumina-watch-folder-list"
										placeholder={$tStore("batchStudio.options.moveTargetFolderPlaceholder")}
										bind:value={newTagMapFolder}
									/>
									<button type="button" onclick={addTagMapping}>
										{$tStore("batchStudio.options.moveAddMappingBtn")}
									</button>
								</div>
								{#if draftRule.moveAction.tagMappings.length > 0}
									<div class="lumina-watch-chip-list">
										{#each draftRule.moveAction.tagMappings as mapping, idx (`${mapping.tag}-${idx}`)}
											<span class="lumina-watch-chip">
												#{mapping.tag} → {mapping.targetFolder}
												<button type="button" onclick={() => removeTagMapping(idx)}>×</button>
											</span>
										{/each}
									</div>
								{/if}
							</div>
						{:else if draftRule.moveAction.mode === "ai-route"}
							<div class="lumina-watch-field">
								<span class="lumina-watch-label">
									{$tStore("batchStudio.options.moveAiCandidatesLabel")}
								</span>
								<div class="lumina-watch-inline-add">
									<input
										type="text"
										list="lumina-watch-folder-list"
										placeholder={$tStore("batchStudio.options.moveAiCandidatesPlaceholder")}
										bind:value={newAiCandidateFolder}
										onkeydown={(e) => {
											if (e.key === "Enter") {
												e.preventDefault();
												addAiCandidate();
											}
										}}
									/>
									<button type="button" onclick={addAiCandidate}>
										{$tStore("batchStudio.options.moveAddCandidateBtn")}
									</button>
								</div>
								{#if draftRule.moveAction.aiCandidateFolders.length > 0}
									<div class="lumina-watch-chip-list">
										{#each draftRule.moveAction.aiCandidateFolders as folder (folder)}
											<span class="lumina-watch-chip">
												{folder}
												<button type="button" onclick={() => removeAiCandidate(folder)}>×</button>
											</span>
										{/each}
									</div>
								{/if}
							</div>
						{/if}

						{#if draftRule.moveAction.mode === "by-tag" || draftRule.moveAction.mode === "ai-route"}
							<div class="lumina-watch-field">
								<label for="lumina-watch-fallback">
									{$tStore("batchStudio.options.moveFallbackFolderLabel")}
								</label>
								<input
									id="lumina-watch-fallback"
									type="text"
									list="lumina-watch-folder-list"
									placeholder={$tStore("batchStudio.options.moveFallbackFolderPlaceholder")}
									bind:value={draftRule.moveAction.fallbackFolder}
								/>
							</div>
						{/if}
					</div>

					<!-- 적용 모드 -->
					<div class="lumina-watch-field">
						<label for="lumina-watch-exec">{$tStore("batchStudio.watch.executionModeLabel")}</label>
						<select
							id="lumina-watch-exec"
							value={draftRule.executionMode}
							onchange={(e) =>
								(draftRule.executionMode = (
									e.currentTarget as HTMLSelectElement
								).value as WatchExecutionMode)}
						>
							<option value="auto-stage">{$tStore("batchStudio.watch.execAutoStage")}</option>
							<option value="auto-apply">{$tStore("batchStudio.watch.execAutoApply")}</option>
						</select>
					</div>
				</div>

				{#if formError}
					<div class="lumina-watch-error">{formError}</div>
				{/if}

				<div class="lumina-watch-editor__footer">
					<button type="button" class="mod-cta" onclick={() => void saveDraftRule()}>
						{$tStore("batchStudio.watch.saveRuleBtn")}
					</button>
				</div>
			</div>
		{/if}

		<!-- 본문 2열 영역: 좌측 규칙 + 우측 검토 대기열 / 활동 로그 -->
		<div class="lumina-watch-body">
			<div class="lumina-watch-col">
				<div class="lumina-watch-section-title">
					<span>Rules ({rules.length})</span>
				</div>
				{#if rules.length === 0}
					<div class="lumina-watch-empty">{$tStore("batchStudio.watch.emptyRules")}</div>
				{:else}
					<div class="lumina-watch-list">
						{#each rules as rule (rule.id)}
							<div class="lumina-watch-card" class:is-disabled={!rule.enabled}>
								<div class="lumina-watch-card__top">
									<label class="lumina-watch-checkbox">
										<input
											type="checkbox"
											checked={rule.enabled}
											onchange={(e) =>
												void toggleRuleEnabled(
													rule.id,
													(e.currentTarget as HTMLInputElement).checked,
												)}
										/>
										<strong>{rule.name}</strong>
									</label>
									<span class="lumina-watch-badge">
										{rule.executionMode === "auto-apply" ? "Auto-Apply" : "Auto-Stage"}
									</span>
								</div>
								<div class="lumina-watch-card__meta">
									<span>📁 {rule.sourceFolder}{rule.includeSubfolders ? "/**" : ""}</span>
									<span>· {getMoveSummary(rule)}</span>
								</div>
								<div class="lumina-watch-chip-list">
									{#each rule.recipes as rId (rId)}
										<span class="lumina-watch-chip is-soft">{getRecipeShortLabel(rId)}</span>
									{/each}
								</div>
								<div class="lumina-watch-card__actions">
									<button type="button" onclick={() => void handleRunRuleNow(rule)}>
										{$tStore("batchStudio.watch.runNowBtn")}
									</button>
									<button type="button" onclick={() => openEditRuleEditor(rule)}>
										{$tStore("batchStudio.watch.editBtn")}
									</button>
									<button type="button" class="mod-warning" onclick={() => void deleteRule(rule.id)}>
										{$tStore("batchStudio.watch.deleteBtn")}
									</button>
								</div>
							</div>
						{/each}
					</div>
				{/if}
			</div>

			<div class="lumina-watch-col">
				<div class="lumina-watch-section-title">
					<span>
						{$tStore("batchStudio.watch.stagedSectionTitle")} ({watchState.stagedItems.length})
					</span>
					{#if watchState.stagedItems.length > 0}
						<button type="button" class="mod-cta" onclick={() => void handleApproveAll()}>
							{$tStore("batchStudio.watch.approveAllBtn", {
								count: watchState.stagedItems.length,
							})}
						</button>
					{/if}
				</div>

				{#if watchState.stagedItems.length === 0}
					<div class="lumina-watch-empty">{$tStore("batchStudio.watch.stagedEmpty")}</div>
				{:else}
					<div class="lumina-watch-list">
						{#each watchState.stagedItems as item (item.id)}
							<div class="lumina-watch-card">
								<div class="lumina-watch-card__top">
									<div>
										<strong>{item.basename}</strong>
										<div class="lumina-watch-subtext">{item.path} · {item.ruleName}</div>
									</div>
									<div class="lumina-watch-card__actions">
										<button type="button" onclick={() => handleRejectStaged(item.id)}>
											{$tStore("batchStudio.watch.rejectBtn")}
										</button>
										<button
											type="button"
											class="mod-cta"
											onclick={() => void handleApproveStaged(item.id)}
										>
											{$tStore("batchStudio.watch.approveBtn")}
										</button>
									</div>
								</div>

								{#each item.steps as step, idx (`${item.id}-${step.recipeId}-${idx}`)}
									<div class="lumina-watch-staged-step">
										<span class="lumina-watch-chip is-soft">
											{getRecipeShortLabel(step.recipeId)}
										</span>
										{#if step.proposed.kind === "frontmatter"}
											<span class="lumina-watch-subtext">
												{#if step.proposed.afterTags?.length}
													tags: {step.proposed.afterTags.map((t) => `#${t}`).join(" ")}
												{/if}
												{#if step.proposed.afterDescription}
													· {step.proposed.afterDescription}
												{/if}
												{#if step.proposed.customFmKey}
													{step.proposed.customFmKey}: {step.proposed.afterCustomFmVal}
												{/if}
											</span>
										{:else if step.proposed.beforeContent !== undefined && step.proposed.afterContent !== undefined}
											<div class="lumina-watch-mini-diff">
												{#each computeLineDiff(step.proposed.beforeContent, step.proposed.afterContent)
													.filter((l) => l.type !== "same")
													.slice(0, 6) as line, i (i)}
													<div class="is-{line.type}">
														{line.type === "added" ? "+" : "-"} {line.text}
													</div>
												{/each}
											</div>
										{/if}
									</div>
								{/each}

								{#if item.moveProposal}
									<div class="lumina-watch-move-preview">
										<span>📁 {item.moveProposal.fromPath} → <strong>{item.moveProposal.toPath}</strong></span>
										{#if item.moveProposal.reason}
											<span class="lumina-watch-subtext">({item.moveProposal.reason})</span>
										{/if}
									</div>
								{/if}
							</div>
						{/each}
					</div>
				{/if}

				<div class="lumina-watch-section-title is-spaced">
					<span>{$tStore("batchStudio.watch.activitySectionTitle")}</span>
				</div>
				{#if watchState.activityLog.length === 0}
					<div class="lumina-watch-empty">{$tStore("batchStudio.watch.activityEmpty")}</div>
				{:else}
					<div class="lumina-watch-log-list">
						{#each watchState.activityLog.slice(0, 30) as entry (entry.id)}
							<div class="lumina-watch-log-row">
								<span class="lumina-watch-badge is-{entry.status}">
									{getLogStatusLabel(entry.status)}
								</span>
								<span class="lumina-watch-log-path">
									{entry.path}{entry.targetPath ? ` → ${entry.targetPath}` : ""}
								</span>
								<span class="lumina-watch-subtext">
									{new Date(entry.timestamp).toLocaleTimeString()}
								</span>
							</div>
						{/each}
					</div>
				{/if}
			</div>
		</div>
	{/if}
</section>

<style>
	.lumina-watch-pane {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 14px 16px;
		gap: 14px;
	}

	.lumina-watch-topbar {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		padding: 12px 14px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		background: var(--background-secondary);
	}

	.lumina-watch-topbar__right {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.lumina-watch-switch-row {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		font-weight: 600;
		cursor: pointer;
	}

	.lumina-watch-subtext {
		font-size: 11px;
		color: var(--text-muted);
	}

	.lumina-watch-pill {
		padding: 3px 8px;
		border-radius: 999px;
		font-size: 11px;
		font-weight: 600;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
	}

	.lumina-watch-mini-num {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		font-size: 11px;
		color: var(--text-muted);
	}

	.lumina-watch-mini-num input {
		width: 56px;
	}

	.lumina-watch-icon {
		display: inline-flex;
		width: 14px;
		height: 14px;
	}

	.lumina-watch-pro-card {
		display: flex;
		flex-direction: column;
		align-items: center;
		text-align: center;
		gap: 10px;
		padding: 36px 24px;
		border-radius: 10px;
		border: 1px dashed var(--background-modifier-border);
		background: var(--background-secondary);
		max-width: 560px;
		margin: 20px auto;
	}

	.lumina-watch-pro-card h3,
	.lumina-watch-pro-card p {
		margin: 0;
	}

	.lumina-watch-pro-card p {
		color: var(--text-muted);
		line-height: 1.5;
	}

	.lumina-watch-editor {
		border: 1px solid var(--interactive-accent);
		border-radius: 8px;
		padding: 14px;
		background: var(--background-secondary);
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.lumina-watch-editor__header,
	.lumina-watch-editor__footer {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.lumina-watch-editor__header h3 {
		margin: 0;
		font-size: 14px;
	}

	.lumina-watch-editor__grid {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}

	.lumina-watch-field {
		display: flex;
		flex-direction: column;
		gap: 4px;
		flex: 1;
	}

	.lumina-watch-field.is-narrow {
		max-width: 120px;
	}

	.lumina-watch-field label,
	.lumina-watch-label {
		font-size: 11px;
		font-weight: 600;
		color: var(--text-muted);
	}

	.lumina-watch-field-row,
	.lumina-watch-field-inline,
	.lumina-watch-inline-add {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.lumina-watch-inline-add input {
		flex: 1;
		min-width: 140px;
	}

	.lumina-watch-checkbox {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		cursor: pointer;
		font-size: 12px;
	}

	.lumina-watch-chip-group,
	.lumina-watch-chip-list {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.lumina-watch-chip-check {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 4px 8px;
		border-radius: 6px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		font-size: 12px;
		cursor: pointer;
	}

	.lumina-watch-chip {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 2px 8px;
		border-radius: 999px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		font-size: 11px;
	}

	.lumina-watch-chip button {
		border: none;
		background: transparent;
		cursor: pointer;
		padding: 0 2px;
		color: var(--text-muted);
	}

	.lumina-watch-subbox {
		padding: 10px;
		border-radius: 6px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.lumina-watch-error {
		color: var(--text-error);
		font-size: 12px;
		font-weight: 500;
	}

	.lumina-watch-body {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(min(320px, 100%), 1fr));
		gap: 14px;
	}

	.lumina-watch-col {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.lumina-watch-section-title {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-weight: 600;
		font-size: 13px;
	}

	.lumina-watch-section-title.is-spaced {
		margin-top: 8px;
	}

	.lumina-watch-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.lumina-watch-card {
		padding: 10px 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		background: var(--background-secondary);
		display: flex;
		flex-direction: column;
		gap: 6px;
	}

	.lumina-watch-card.is-disabled {
		opacity: 0.65;
	}

	.lumina-watch-card__top {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.lumina-watch-card__meta {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
		font-size: 11px;
		color: var(--text-muted);
	}

	.lumina-watch-card__actions {
		display: flex;
		flex-wrap: wrap;
		gap: 6px;
	}

	.lumina-watch-badge {
		padding: 2px 7px;
		border-radius: 999px;
		font-size: 10px;
		font-weight: 600;
		background: var(--background-primary);
		border: 1px solid var(--background-modifier-border);
	}

	.lumina-watch-badge.is-applied,
	.lumina-watch-badge.is-moved {
		color: var(--color-green);
	}

	.lumina-watch-badge.is-failed,
	.lumina-watch-badge.is-burst-paused {
		color: var(--text-error);
	}

	.lumina-watch-staged-step {
		display: flex;
		flex-direction: column;
		gap: 4px;
		padding-top: 4px;
	}

	.lumina-watch-mini-diff {
		font-family: var(--font-monospace);
		font-size: 11px;
		padding: 4px 6px;
		border-radius: 4px;
		background: var(--background-primary);
	}

	.lumina-watch-mini-diff .is-added {
		color: var(--color-green);
	}

	.lumina-watch-mini-diff .is-removed {
		color: var(--text-error);
	}

	.lumina-watch-move-preview {
		padding: 6px 8px;
		border-radius: 6px;
		background: var(--background-primary);
		font-size: 12px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.lumina-watch-log-list {
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.lumina-watch-log-row {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 5px 8px;
		border-radius: 6px;
		background: var(--background-secondary);
		font-size: 11px;
	}

	.lumina-watch-log-path {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lumina-watch-empty {
		padding: 18px;
		text-align: center;
		color: var(--text-muted);
		border: 1px dashed var(--background-modifier-border);
		border-radius: 8px;
		font-size: 12px;
	}

	.lumina-watch-btn-ghost {
		border: none;
		background: transparent;
		color: var(--text-muted);
		cursor: pointer;
	}
</style>
