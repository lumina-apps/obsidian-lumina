<script lang="ts">
	import { Notice, TFile, normalizePath } from "obsidian";
	import { onDestroy, onMount, untrack } from "svelte";
	import type LuminaPlugin from "../../../main";
	import type { MocGroupBy } from "../../../core/mcp/server/handlers/utils/mocUtils";
	import { sendOrphansToWorkspace } from "../../../core/store/batchStore";
	import { hasProFeature } from "../../../core/store/entitlementStore";
	import { activeProject } from "../../../core/store/projectStore";
	import { syncSettingsStore } from "../../../core/store/settingsStore";
	import { debugLogger } from "../../../shared/debugLogger";
	import { tStore } from "../../../shared/locales/index";
	import type {
		OrphanAiLinkProposal,
		OrphanDetectionMode,
		OrphanLinkDirection,
		OrphanLinkSuggestion,
		OrphanNoteItem,
		OrphanNotesPreferences,
		OrphanSortKey,
	} from "../../../shared/types/orphan.types";
	import { normalizeError } from "../../../shared/utils/errorUtils";
	import { icon } from "../../../shared/utils/iconAction";
	import { formatLlmError } from "../../../shared/utils/llmErrorFormatter";
	import {
		DEFAULT_ORPHAN_PREFERENCES,
		resolveOrphanPreferences,
	} from "../../../shared/utils/orphanUtils";
	import { notifyProFeatureLocked } from "../../../shared/utils/proUpgradeModal";
	import { openLinkTextSafely } from "../../../shared/utils/workspaceNavUtils";
	import { computeLineDiff, listVaultFolders } from "../batchTargetResolver";
	import {
		applyAiContextualLinkProposal,
		archiveOrphanFiles,
		createOrAppendOrphanMoc,
		insertOrphanWikiLink,
		proposeAiContextualLink,
		recordOrphanHistory,
		trashOrphanFiles,
	} from "../orphans/orphanActionService";
	import { recommendLinksForOrphan } from "../orphans/orphanRecommender";
	import { clearCanvasRefCache, scanOrphanNotes } from "../orphans/orphanScanner";

	let { plugin }: { plugin: LuminaPlugin } = $props();

	const isProBatch = hasProFeature("batch-studio");

	let prefs = $state<OrphanNotesPreferences>(
		untrack(() => resolveOrphanPreferences(plugin.settings?.orphanNotes)),
	);
	let emptyOnly = $state(false);
	let showIgnored = $state(false);
	let folderFilter = $state("");
	let searchQuery = $state("");
	let sortBy = $state<OrphanSortKey>("mtime-desc");

	let items = $state<OrphanNoteItem[]>([]);
	let totalMarkdown = $state(0);
	let ignoredCount = $state(0);
	let isScanning = $state(false);

	let selectedPath = $state<string | null>(null);
	let checkedPaths = $state<string[]>([]);

	let previewText = $state("");
	let isLoadingDetail = $state(false);
	let suggestions = $state<OrphanLinkSuggestion[]>([]);
	let linkDirection = $state<OrphanLinkDirection>("from-orphan");

	let isProcessingAction = $state(false);
	let aiProposal = $state<OrphanAiLinkProposal | null>(null);
	let aiLoadingTargetPath = $state<string | null>(null);

	let confirmBulkTrash = $state(false);
	let mocFormOpen = $state(false);
	let mocPathInput = $state("MOCs/Orphan Notes.md");
	let mocTitleInput = $state("Orphan Notes MOC");
	let mocGroupBy = $state<MocGroupBy>("folder");

	let scanSeq = 0;
	let detailSeq = 0;
	let rescanTimer: number | null = null;
	let detailAbortController: AbortController | null = null;

	const selectedItem = $derived(items.find((i) => i.path === selectedPath) ?? null);
	const checkedSet = $derived(new Set(checkedPaths));
	const selectedCount = $derived(checkedPaths.length);
	const allVisibleChecked = $derived(
		items.length > 0 && items.every((item) => checkedSet.has(item.path)),
	);
	const vaultFolders = $derived.by(() => {
		void items;
		return listVaultFolders(plugin.app);
	});
	const aiDiffLines = $derived(
		aiProposal ? computeLineDiff(aiProposal.beforeContent, aiProposal.afterContent) : [],
	);

	onMount(() => {
		void runScan();

		const scheduleRescan = () => {
			if (rescanTimer !== null) {
				window.clearTimeout(rescanTimer);
			}
			rescanTimer = window.setTimeout(() => {
				rescanTimer = null;
				void runScan();
			}, 250);
		};

		const vaultRefs = [
			plugin.app.vault?.on?.("create", scheduleRescan),
			plugin.app.vault?.on?.("delete", scheduleRescan),
			plugin.app.vault?.on?.("rename", scheduleRescan),
		].filter((r): r is NonNullable<typeof r> => Boolean(r));
		const metaRef = plugin.app.metadataCache?.on?.("changed", scheduleRescan);

		return () => {
			if (rescanTimer !== null) {
				window.clearTimeout(rescanTimer);
				rescanTimer = null;
			}
			for (const ref of vaultRefs) {
				plugin.app.vault?.offref?.(ref);
			}
			if (metaRef) {
				plugin.app.metadataCache?.offref?.(metaRef);
			}
			detailAbortController?.abort();
			clearCanvasRefCache();
		};
	});

	onDestroy(() => {
		if (rescanTimer !== null) {
			window.clearTimeout(rescanTimer);
			rescanTimer = null;
		}
		detailAbortController?.abort();
	});

	async function persistPreferences(next: OrphanNotesPreferences): Promise<void> {
		prefs = next;
		if (!plugin.settings) return;
		plugin.settings.orphanNotes = { ...next };
		if (typeof plugin.saveSettings === "function") {
			try {
				await plugin.saveSettings();
				syncSettingsStore(plugin.settings);
			} catch (err) {
				debugLogger.logError("batch", normalizeError(err, "Orphan settings save failed"));
			}
		}
	}

	async function runScan(): Promise<void> {
		const seq = ++scanSeq;
		isScanning = true;
		try {
			const excludedPaths = $activeProject?.ragExcludedPaths ?? [];
			const res = await scanOrphanNotes(plugin.app, {
				mode: prefs.mode,
				gracePeriodDays: prefs.gracePeriodDays,
				includeCanvasRefs: prefs.includeCanvasRefs,
				emptyOnly,
				folderFilter,
				searchQuery,
				showIgnored,
				sortBy,
				ignoredPaths: prefs.ignoredPaths,
				ignoredFolders: prefs.ignoredFolders,
				ignoredTags: prefs.ignoredTags,
				excludedPaths,
			});
			if (seq !== scanSeq) return;

			items = res.items;
			totalMarkdown = res.totalMarkdown;
			ignoredCount = res.ignoredCount;

			const visiblePathSet = new Set(res.items.map((i) => i.path));
			checkedPaths = checkedPaths.filter((p) => visiblePathSet.has(p));

			if (selectedPath && !visiblePathSet.has(selectedPath)) {
				selectedPath = res.items[0]?.path ?? null;
			} else if (!selectedPath && res.items.length > 0) {
				selectedPath = res.items[0].path;
			}
		} catch (err) {
			debugLogger.logError("batch", normalizeError(err, "Orphan scan failed"));
		} finally {
			if (seq === scanSeq) {
				isScanning = false;
			}
		}
	}

	$effect(() => {
		const path = selectedPath;
		void loadInspectorForPath(path);
	});

	async function loadInspectorForPath(path: string | null): Promise<void> {
		detailAbortController?.abort();
		aiProposal = null;
		aiLoadingTargetPath = null;

		if (!path) {
			previewText = "";
			suggestions = [];
			isLoadingDetail = false;
			return;
		}

		const abstractFile = plugin.app.vault?.getAbstractFileByPath?.(path);
		if (!(abstractFile instanceof TFile)) {
			previewText = "";
			suggestions = [];
			isLoadingDetail = false;
			return;
		}

		const seq = ++detailSeq;
		const ac = new AbortController();
		detailAbortController = ac;
		isLoadingDetail = true;

		try {
			const excludedPaths = $activeProject?.ragExcludedPaths ?? [];
			const [raw, recs] = await Promise.all([
				plugin.app.vault.read(abstractFile),
				recommendLinksForOrphan(plugin.app, plugin, abstractFile, {
					topK: 5,
					excludedPaths,
				}),
			]);
			if (seq !== detailSeq || ac.signal.aborted) return;
			previewText = raw.slice(0, 1500);
			suggestions = recs;
		} catch (err) {
			if (seq === detailSeq && !ac.signal.aborted) {
				debugLogger.logError("batch", normalizeError(err, "Orphan detail load failed"));
				previewText = "";
				suggestions = [];
			}
		} finally {
			if (seq === detailSeq) {
				isLoadingDetail = false;
			}
		}
	}

	function handleModeChange(mode: OrphanDetectionMode): void {
		void persistPreferences({ ...prefs, mode }).then(() => runScan());
	}

	function handleGraceDaysChange(val: number): void {
		const safe = Number.isFinite(val) ? Math.max(0, Math.floor(val)) : 7;
		void persistPreferences({ ...prefs, gracePeriodDays: safe }).then(() => runScan());
	}

	function handleCanvasToggle(checked: boolean): void {
		void persistPreferences({ ...prefs, includeCanvasRefs: checked }).then(() => runScan());
	}

	function handleArchiveFolderChange(val: string): void {
		void persistPreferences({
			...prefs,
			archiveFolder: val.trim() || DEFAULT_ORPHAN_PREFERENCES.archiveFolder,
		});
	}

	function toggleChecked(path: string): void {
		confirmBulkTrash = false;
		if (checkedSet.has(path)) {
			checkedPaths = checkedPaths.filter((p) => p !== path);
		} else {
			checkedPaths = [...checkedPaths, path];
		}
	}

	function toggleSelectAllVisible(): void {
		confirmBulkTrash = false;
		if (allVisibleChecked) {
			checkedPaths = [];
		} else {
			checkedPaths = items.map((i) => i.path);
		}
	}

	function openNote(path: string): void {
		void openLinkTextSafely(plugin.app, path, "", false);
	}

	async function handleToggleIgnore(item: OrphanNoteItem): Promise<void> {
		const norm = normalizePath(item.path);
		const exists = prefs.ignoredPaths.some((p) => normalizePath(p) === norm);
		const nextIgnored = exists
			? prefs.ignoredPaths.filter((p) => normalizePath(p) !== norm)
			: [...prefs.ignoredPaths, norm];

		await persistPreferences({ ...prefs, ignoredPaths: nextIgnored });
		new Notice(
			exists
				? $tStore("batchStudio.orphans.unignoredNotice", { name: item.basename })
				: $tStore("batchStudio.orphans.ignoredNotice", { name: item.basename }),
		);
		await runScan();
	}

	async function handleInsertSingleLink(suggestion: OrphanLinkSuggestion): Promise<void> {
		if (!selectedItem || isProcessingAction) return;
		const orphanFile = plugin.app.vault.getAbstractFileByPath(selectedItem.path);
		const targetFile = plugin.app.vault.getAbstractFileByPath(suggestion.path);
		if (!(orphanFile instanceof TFile) || !(targetFile instanceof TFile)) return;

		isProcessingAction = true;
		try {
			const res = await insertOrphanWikiLink(
				plugin.app,
				orphanFile,
				targetFile,
				linkDirection,
			);
			if (res.skipped) {
				new Notice($tStore("batchStudio.orphans.linkAlreadyExists"));
			} else if (res.snapshot) {
				recordOrphanHistory(
					[res.snapshot],
					$tStore("batchStudio.orphans.historyLinkAction", { count: 1 }),
				);
				new Notice(
					$tStore("batchStudio.orphans.linkInsertedNotice", { name: suggestion.basename }),
				);
				await runScan();
				await loadInspectorForPath(selectedPath);
			}
		} catch (err) {
			const msg = formatLlmError(err);
			debugLogger.logError("batch", normalizeError(err, `Insert orphan link failed: ${msg}`));
			new Notice(msg);
		} finally {
			isProcessingAction = false;
		}
	}

	async function handleProposeAiLink(suggestion: OrphanLinkSuggestion): Promise<void> {
		if (!$isProBatch) {
			notifyProFeatureLocked(
				plugin.app,
				"batch-studio",
				$tStore("batchStudio.orphans.proAiLinkNotice"),
			);
			return;
		}
		if (!selectedItem || aiLoadingTargetPath || isProcessingAction) return;
		const orphanFile = plugin.app.vault.getAbstractFileByPath(selectedItem.path);
		const targetFile = plugin.app.vault.getAbstractFileByPath(suggestion.path);
		if (!(orphanFile instanceof TFile) || !(targetFile instanceof TFile)) return;

		aiLoadingTargetPath = suggestion.path;
		aiProposal = null;
		try {
			aiProposal = await proposeAiContextualLink(
				plugin.app,
				plugin,
				orphanFile,
				targetFile,
				linkDirection,
			);
		} catch (err) {
			const msg = formatLlmError(err);
			debugLogger.logError("batch", normalizeError(err, `AI contextual link failed: ${msg}`));
			new Notice(msg);
		} finally {
			aiLoadingTargetPath = null;
		}
	}

	async function handleApplyAiProposal(): Promise<void> {
		if (!aiProposal || isProcessingAction) return;
		isProcessingAction = true;
		try {
			const snapshot = await applyAiContextualLinkProposal(plugin.app, aiProposal);
			if (snapshot) {
				recordOrphanHistory(
					[snapshot],
					$tStore("batchStudio.orphans.historyAiLinkAction", { count: 1 }),
				);
				new Notice(
					$tStore("batchStudio.orphans.linkInsertedNotice", {
						name: aiProposal.modifiedFilePath,
					}),
				);
				aiProposal = null;
				await runScan();
				await loadInspectorForPath(selectedPath);
			} else {
				new Notice($tStore("batchStudio.orphans.linkAlreadyExists"));
				aiProposal = null;
			}
		} catch (err) {
			const msg = formatLlmError(err);
			debugLogger.logError("batch", normalizeError(err, `Apply AI link failed: ${msg}`));
			new Notice(msg);
		} finally {
			isProcessingAction = false;
		}
	}

	async function handleArchiveSingle(item: OrphanNoteItem): Promise<void> {
		if (isProcessingAction) return;
		const file = plugin.app.vault.getAbstractFileByPath(item.path);
		if (!(file instanceof TFile)) return;

		isProcessingAction = true;
		try {
			const excludedPaths = $activeProject?.ragExcludedPaths ?? [];
			const res = await archiveOrphanFiles(
				plugin.app,
				[file],
				prefs.archiveFolder,
				excludedPaths,
			);
			if (res.snapshots.length > 0) {
				recordOrphanHistory(
					res.snapshots,
					$tStore("batchStudio.orphans.historyArchiveAction", { count: res.movedCount }),
				);
				new Notice(
					$tStore("batchStudio.orphans.archivedNotice", {
						count: res.movedCount,
						folder: prefs.archiveFolder,
					}),
				);
				await runScan();
			}
		} catch (err) {
			const msg = formatLlmError(err);
			debugLogger.logError("batch", normalizeError(err, `Archive single failed: ${msg}`));
			new Notice(msg);
		} finally {
			isProcessingAction = false;
		}
	}

	async function handleTrashSingle(item: OrphanNoteItem): Promise<void> {
		if (isProcessingAction) return;
		const file = plugin.app.vault.getAbstractFileByPath(item.path);
		if (!(file instanceof TFile)) return;

		isProcessingAction = true;
		try {
			const res = await trashOrphanFiles(plugin.app, [file]);
			if (res.snapshots.length > 0) {
				recordOrphanHistory(
					res.snapshots,
					$tStore("batchStudio.orphans.historyTrashAction", { count: res.trashedCount }),
				);
				new Notice(
					$tStore("batchStudio.orphans.trashedNotice", { count: res.trashedCount }),
				);
				await runScan();
			}
		} catch (err) {
			const msg = formatLlmError(err);
			debugLogger.logError("batch", normalizeError(err, `Trash single failed: ${msg}`));
			new Notice(msg);
		} finally {
			isProcessingAction = false;
		}
	}

	function resolveCheckedFiles(): TFile[] {
		const files: TFile[] = [];
		for (const p of checkedPaths) {
			const f = plugin.app.vault.getAbstractFileByPath(p);
			if (f instanceof TFile) files.push(f);
		}
		return files;
	}

	async function handleBulkLink(): Promise<void> {
		if (!$isProBatch) {
			notifyProFeatureLocked(
				plugin.app,
				"batch-studio",
				$tStore("batchStudio.orphans.proBulkNotice"),
			);
			return;
		}
		const targetFiles = resolveCheckedFiles();
		if (targetFiles.length === 0 || isProcessingAction) return;

		isProcessingAction = true;
		try {
			const excludedPaths = $activeProject?.ragExcludedPaths ?? [];
			const snapshots = [];
			for (const orphanFile of targetFiles) {
				const recs = await recommendLinksForOrphan(plugin.app, plugin, orphanFile, {
					topK: 1,
					excludedPaths,
				});
				if (recs.length === 0) continue;
				const topFile = plugin.app.vault.getAbstractFileByPath(recs[0].path);
				if (!(topFile instanceof TFile)) continue;
				const res = await insertOrphanWikiLink(
					plugin.app,
					orphanFile,
					topFile,
					linkDirection,
				);
				if (!res.skipped && res.snapshot) {
					snapshots.push(res.snapshot);
				}
			}

			if (snapshots.length > 0) {
				recordOrphanHistory(
					snapshots,
					$tStore("batchStudio.orphans.historyLinkAction", { count: snapshots.length }),
				);
				new Notice(
					$tStore("batchStudio.orphans.bulkLinkDone", { count: snapshots.length }),
				);
				checkedPaths = [];
				await runScan();
			} else {
				new Notice($tStore("batchStudio.orphans.bulkLinkNone"));
			}
		} catch (err) {
			const msg = formatLlmError(err);
			debugLogger.logError("batch", normalizeError(err, `Bulk link failed: ${msg}`));
			new Notice(msg);
		} finally {
			isProcessingAction = false;
		}
	}

	async function handleBulkArchive(): Promise<void> {
		if (!$isProBatch) {
			notifyProFeatureLocked(
				plugin.app,
				"batch-studio",
				$tStore("batchStudio.orphans.proBulkNotice"),
			);
			return;
		}
		const targetFiles = resolveCheckedFiles();
		if (targetFiles.length === 0 || isProcessingAction) return;

		isProcessingAction = true;
		try {
			const excludedPaths = $activeProject?.ragExcludedPaths ?? [];
			const res = await archiveOrphanFiles(
				plugin.app,
				targetFiles,
				prefs.archiveFolder,
				excludedPaths,
			);
			if (res.snapshots.length > 0) {
				recordOrphanHistory(
					res.snapshots,
					$tStore("batchStudio.orphans.historyArchiveAction", { count: res.movedCount }),
				);
				new Notice(
					$tStore("batchStudio.orphans.archivedNotice", {
						count: res.movedCount,
						folder: prefs.archiveFolder,
					}),
				);
				checkedPaths = [];
				await runScan();
			}
		} catch (err) {
			const msg = formatLlmError(err);
			debugLogger.logError("batch", normalizeError(err, `Bulk archive failed: ${msg}`));
			new Notice(msg);
		} finally {
			isProcessingAction = false;
		}
	}

	async function handleBulkTrash(): Promise<void> {
		if (!$isProBatch) {
			notifyProFeatureLocked(
				plugin.app,
				"batch-studio",
				$tStore("batchStudio.orphans.proBulkNotice"),
			);
			return;
		}
		const targetFiles = resolveCheckedFiles();
		if (targetFiles.length === 0 || isProcessingAction) return;

		confirmBulkTrash = false;
		isProcessingAction = true;
		try {
			const res = await trashOrphanFiles(plugin.app, targetFiles);
			if (res.snapshots.length > 0) {
				recordOrphanHistory(
					res.snapshots,
					$tStore("batchStudio.orphans.historyTrashAction", { count: res.trashedCount }),
				);
				new Notice(
					$tStore("batchStudio.orphans.trashedNotice", { count: res.trashedCount }),
				);
				checkedPaths = [];
				await runScan();
			}
		} catch (err) {
			const msg = formatLlmError(err);
			debugLogger.logError("batch", normalizeError(err, `Bulk trash failed: ${msg}`));
			new Notice(msg);
		} finally {
			isProcessingAction = false;
		}
	}

	function handleOpenMocForm(): void {
		if (!$isProBatch) {
			notifyProFeatureLocked(
				plugin.app,
				"batch-studio",
				$tStore("batchStudio.orphans.proMocNotice"),
			);
			return;
		}
		mocFormOpen = !mocFormOpen;
	}

	async function handleCreateMoc(): Promise<void> {
		if (!$isProBatch) return;
		const targetFiles = resolveCheckedFiles();
		if (targetFiles.length === 0 || isProcessingAction) return;

		isProcessingAction = true;
		try {
			const excludedPaths = $activeProject?.ragExcludedPaths ?? [];
			const res = await createOrAppendOrphanMoc(
				plugin.app,
				targetFiles,
				mocPathInput,
				mocTitleInput,
				mocGroupBy,
				excludedPaths,
			);
			if (res.snapshot) {
				recordOrphanHistory(
					[res.snapshot],
					$tStore("batchStudio.orphans.historyMocAction", { count: res.addedCount }),
				);
			}
			new Notice(
				$tStore("batchStudio.orphans.mocSavedNotice", {
					path: res.mocPath,
					count: res.addedCount,
				}),
			);
			mocFormOpen = false;
			checkedPaths = [];
			await runScan();
		} catch (err) {
			const msg = formatLlmError(err);
			debugLogger.logError("batch", normalizeError(err, `Create MOC failed: ${msg}`));
			new Notice(msg);
		} finally {
			isProcessingAction = false;
		}
	}

	function handleSendToWorkspace(): void {
		const ok = sendOrphansToWorkspace(prefs.mode);
		if (!ok) {
			new Notice($tStore("batchStudio.execution.alreadyRunningNotice"));
		}
	}

	function formatSize(bytes: number): string {
		if (bytes < 1024) return `${bytes} B`;
		return `${(bytes / 1024).toFixed(1)} KB`;
	}

	function formatDate(ts: number): string {
		if (!ts) return "-";
		return new Date(ts).toLocaleDateString();
	}
</script>

<div class="lumina-orphan-tab">
	<!-- 상단 필터 및 제어 바 -->
	<section class="lumina-orphan-toolbar">
		<div class="lumina-orphan-toolbar__row">
			<div class="lumina-orphan-segmented">
				<button
					type="button"
					class:is-active={prefs.mode === "isolated"}
					onclick={() => handleModeChange("isolated")}
				>
					{$tStore("batchStudio.orphans.modeIsolated")}
				</button>
				<button
					type="button"
					class:is-active={prefs.mode === "no-backlinks"}
					onclick={() => handleModeChange("no-backlinks")}
				>
					{$tStore("batchStudio.orphans.modeNoBacklinks")}
				</button>
			</div>

			<label class="lumina-orphan-inline-field">
				<span>{$tStore("batchStudio.orphans.graceDaysLabel")}</span>
				<input
					type="number"
					min="0"
					step="1"
					class="lumina-orphan-num-input"
					value={prefs.gracePeriodDays}
					onchange={(e) =>
						handleGraceDaysChange(Number((e.currentTarget as HTMLInputElement).value))}
				/>
			</label>

			<label class="lumina-orphan-check-pill">
				<input
					type="checkbox"
					checked={prefs.includeCanvasRefs}
					onchange={(e) => handleCanvasToggle((e.currentTarget as HTMLInputElement).checked)}
				/>
				<span>{$tStore("batchStudio.orphans.excludeCanvasLabel")}</span>
			</label>

			<label class="lumina-orphan-check-pill">
				<input
					type="checkbox"
					checked={emptyOnly}
					onchange={(e) => {
						emptyOnly = (e.currentTarget as HTMLInputElement).checked;
						void runScan();
					}}
				/>
				<span>{$tStore("batchStudio.orphans.emptyOnlyLabel")}</span>
			</label>

			<label class="lumina-orphan-check-pill">
				<input
					type="checkbox"
					checked={showIgnored}
					onchange={(e) => {
						showIgnored = (e.currentTarget as HTMLInputElement).checked;
						void runScan();
					}}
				/>
				<span>{$tStore("batchStudio.orphans.showIgnoredLabel", { count: ignoredCount })}</span>
			</label>
		</div>

		<div class="lumina-orphan-toolbar__row">
			<input
				type="text"
				class="lumina-orphan-input"
				placeholder={$tStore("batchStudio.orphans.searchPlaceholder")}
				value={searchQuery}
				oninput={(e) => {
					searchQuery = (e.currentTarget as HTMLInputElement).value;
					void runScan();
				}}
			/>

			<input
				type="text"
				list="lumina-orphan-folder-list"
				class="lumina-orphan-input is-folder"
				placeholder={$tStore("batchStudio.orphans.folderPlaceholder")}
				value={folderFilter}
				oninput={(e) => {
					folderFilter = (e.currentTarget as HTMLInputElement).value;
					void runScan();
				}}
			/>
			<datalist id="lumina-orphan-folder-list">
				{#each vaultFolders as folder (folder)}
					<option value={folder}></option>
				{/each}
			</datalist>

			<select
				class="lumina-orphan-select"
				value={sortBy}
				onchange={(e) => {
					sortBy = (e.currentTarget as HTMLSelectElement).value as OrphanSortKey;
					void runScan();
				}}
			>
				<option value="mtime-desc">{$tStore("batchStudio.orphans.sortMtimeDesc")}</option>
				<option value="mtime-asc">{$tStore("batchStudio.orphans.sortMtimeAsc")}</option>
				<option value="name-asc">{$tStore("batchStudio.orphans.sortNameAsc")}</option>
				<option value="size-asc">{$tStore("batchStudio.orphans.sortSizeAsc")}</option>
			</select>

			<button type="button" class="lumina-orphan-btn" onclick={() => void runScan()} disabled={isScanning}>
				<span class="lumina-orphan-icon" use:icon={"refresh-cw"}></span>
				<span>{$tStore("batchStudio.orphans.rescanBtn")}</span>
			</button>

			<button type="button" class="lumina-orphan-btn" onclick={handleSendToWorkspace}>
				<span class="lumina-orphan-icon" use:icon={"send"}></span>
				<span>{$tStore("batchStudio.orphans.sendToWorkspaceBtn")}</span>
			</button>
		</div>
	</section>

	<!-- 본문 2단 마스터-디테일 영역 -->
	<div class="lumina-orphan-workbench">
		<!-- 좌측 목록 & Pro 일괄 작업 바 -->
		<aside class="lumina-orphan-list-pane">
			<div class="lumina-orphan-list-header">
				<label class="lumina-orphan-check-pill">
					<input
						type="checkbox"
						checked={allVisibleChecked}
						onchange={toggleSelectAllVisible}
					/>
					<span>
						{$tStore("batchStudio.orphans.summaryCount", {
							count: items.length,
							total: totalMarkdown,
						})}
					</span>
				</label>
				{#if selectedCount > 0}
					<span class="lumina-orphan-selected-badge">
						{$tStore("batchStudio.orphans.selectedBadge", { count: selectedCount })}
					</span>
				{/if}
			</div>

			<div class="lumina-orphan-list-scroll">
				{#if isScanning && items.length === 0}
					<div class="lumina-orphan-empty">
						<p>{$tStore("batchStudio.orphans.scanning")}</p>
					</div>
				{:else if items.length === 0}
					<div class="lumina-orphan-empty">
						<span class="lumina-orphan-empty__icon" use:icon={"check-circle-2"}></span>
						<p>{$tStore("batchStudio.orphans.emptyList")}</p>
					</div>
				{:else}
					{#each items as item (item.path)}
						<div
							class="lumina-orphan-item"
							class:is-active={selectedPath === item.path}
						>
							<input
								type="checkbox"
								checked={checkedSet.has(item.path)}
								onclick={(e) => e.stopPropagation()}
								onchange={() => toggleChecked(item.path)}
								aria-label={item.basename}
							/>
							<button
								type="button"
								class="lumina-orphan-item__body"
								onclick={() => (selectedPath = item.path)}
							>
								<div class="lumina-orphan-item__title-row">
									<span class="lumina-orphan-item__title">{item.basename}</span>
									{#if item.isEmpty}
										<span class="lumina-orphan-pill is-warn">
											{$tStore("batchStudio.orphans.emptyBadge")}
										</span>
									{/if}
									{#if item.isIgnored}
										<span class="lumina-orphan-pill">
											{$tStore("batchStudio.orphans.ignoredBadge")}
										</span>
									{/if}
								</div>
								<div class="lumina-orphan-item__meta">
									<span>{item.folder || "/"}</span>
									<span>· {formatDate(item.mtime)}</span>
									<span>· {formatSize(item.size)}</span>
								</div>
							</button>
						</div>
					{/each}
				{/if}
			</div>

			<!-- 하단 일괄 작업 바 (Pro 잠금) -->
			<div class="lumina-orphan-bulk-bar">
				{#if confirmBulkTrash}
					<div class="lumina-orphan-confirm-row">
						<span>
							{$tStore("batchStudio.orphans.bulkTrashConfirm", { count: selectedCount })}
						</span>
						<button
							type="button"
							class="mod-warning"
							disabled={isProcessingAction}
							onclick={() => void handleBulkTrash()}
						>
							{$tStore("batchStudio.orphans.confirmTrashBtn")}
						</button>
						<button type="button" onclick={() => (confirmBulkTrash = false)}>
							{$tStore("common.cancel")}
						</button>
					</div>
				{:else}
					<div class="lumina-orphan-bulk-actions">
						<button
							type="button"
							class="lumina-orphan-btn"
							class:is-locked={!$isProBatch}
							disabled={selectedCount === 0 || isProcessingAction}
							onclick={() => void handleBulkLink()}
						>
							<span>{$tStore("batchStudio.orphans.bulkLinkBtn")}</span>
							{#if !$isProBatch}🔒{/if}
						</button>

						<button
							type="button"
							class="lumina-orphan-btn"
							class:is-locked={!$isProBatch}
							disabled={selectedCount === 0 || isProcessingAction}
							onclick={() => void handleBulkArchive()}
						>
							<span>{$tStore("batchStudio.orphans.bulkArchiveBtn")}</span>
							{#if !$isProBatch}🔒{/if}
						</button>

						<button
							type="button"
							class="lumina-orphan-btn"
							class:is-locked={!$isProBatch}
							disabled={selectedCount === 0 || isProcessingAction}
							onclick={handleOpenMocForm}
						>
							<span>{$tStore("batchStudio.orphans.bulkMocBtn")}</span>
							{#if !$isProBatch}🔒{/if}
						</button>

						<button
							type="button"
							class="lumina-orphan-btn is-danger"
							class:is-locked={!$isProBatch}
							disabled={selectedCount === 0 || isProcessingAction}
							onclick={() => {
								if (!$isProBatch) {
									notifyProFeatureLocked(
										plugin.app,
										"batch-studio",
										$tStore("batchStudio.orphans.proBulkNotice"),
									);
									return;
								}
								confirmBulkTrash = true;
							}}
						>
							<span>{$tStore("batchStudio.orphans.bulkTrashBtn")}</span>
							{#if !$isProBatch}🔒{/if}
						</button>
					</div>
				{/if}

				{#if mocFormOpen && $isProBatch}
					<div class="lumina-orphan-moc-form">
						<input
							type="text"
							class="lumina-orphan-input"
							placeholder={$tStore("batchStudio.orphans.mocPathPlaceholder")}
							bind:value={mocPathInput}
						/>
						<input
							type="text"
							class="lumina-orphan-input"
							placeholder={$tStore("batchStudio.orphans.mocTitlePlaceholder")}
							bind:value={mocTitleInput}
						/>
						<div class="lumina-orphan-moc-form__row">
							<select class="lumina-orphan-select" bind:value={mocGroupBy}>
								<option value="folder">{$tStore("batchStudio.orphans.mocGroupFolder")}</option>
								<option value="tag">{$tStore("batchStudio.orphans.mocGroupTag")}</option>
								<option value="none">{$tStore("batchStudio.orphans.mocGroupNone")}</option>
							</select>
							<button
								type="button"
								class="mod-cta"
								disabled={selectedCount === 0 || isProcessingAction}
								onclick={() => void handleCreateMoc()}
							>
								{$tStore("batchStudio.orphans.mocCreateBtn")}
							</button>
						</div>
					</div>
				{/if}
			</div>
		</aside>

		<!-- 우측 인스펙터: 무료 개별 무제한 구출·정리 & Pro AI 문맥 Diff -->
		<section class="lumina-orphan-inspector">
			{#if !selectedItem}
				<div class="lumina-orphan-empty">
					<span class="lumina-orphan-empty__icon" use:icon={"file-search"}></span>
					<p>{$tStore("batchStudio.orphans.emptySelection")}</p>
				</div>
			{:else}
				<div class="lumina-orphan-inspector__header">
					<div>
						<h3 class="lumina-orphan-inspector__title">{selectedItem.basename}</h3>
						<div class="lumina-orphan-inspector__path">{selectedItem.path}</div>
					</div>
					<button
						type="button"
						class="lumina-orphan-btn"
						onclick={() => openNote(selectedItem.path)}
					>
						<span class="lumina-orphan-icon" use:icon={"external-link"}></span>
						<span>{$tStore("batchStudio.inspector.openNoteBtn")}</span>
					</button>
				</div>

				<!-- 무료 개별 무제한 정리 바 -->
				<div class="lumina-orphan-single-actions">
					<div class="lumina-orphan-archive-group">
						<input
							type="text"
							list="lumina-orphan-folder-list"
							class="lumina-orphan-input"
							placeholder={$tStore("batchStudio.orphans.archiveFolderPlaceholder")}
							value={prefs.archiveFolder}
							onchange={(e) =>
								handleArchiveFolderChange((e.currentTarget as HTMLInputElement).value)}
						/>
						<button
							type="button"
							class="lumina-orphan-btn"
							disabled={isProcessingAction}
							onclick={() => void handleArchiveSingle(selectedItem)}
						>
							<span class="lumina-orphan-icon" use:icon={"archive"}></span>
							<span>{$tStore("batchStudio.orphans.archiveBtn")}</span>
						</button>
					</div>

					<button
						type="button"
						class="lumina-orphan-btn is-danger"
						disabled={isProcessingAction}
						onclick={() => void handleTrashSingle(selectedItem)}
					>
						<span class="lumina-orphan-icon" use:icon={"trash-2"}></span>
						<span>{$tStore("batchStudio.orphans.trashBtn")}</span>
					</button>

					<button
						type="button"
						class="lumina-orphan-btn"
						disabled={isProcessingAction}
						onclick={() => void handleToggleIgnore(selectedItem)}
					>
						<span class="lumina-orphan-icon" use:icon={"eye-off"}></span>
						<span>
							{selectedItem.isIgnored
								? $tStore("batchStudio.orphans.unignoreBtn")
								: $tStore("batchStudio.orphans.ignoreBtn")}
						</span>
					</button>
				</div>

				<!-- 연결 추천 섹션 -->
				<div class="lumina-orphan-section">
					<div class="lumina-orphan-section__header">
						<h4>{$tStore("batchStudio.orphans.recommendationsTitle")}</h4>
						<div class="lumina-orphan-segmented">
							<button
								type="button"
								class:is-active={linkDirection === "from-orphan"}
								onclick={() => (linkDirection = "from-orphan")}
							>
								{$tStore("batchStudio.orphans.dirFromOrphan")}
							</button>
							<button
								type="button"
								class:is-active={linkDirection === "to-orphan"}
								onclick={() => (linkDirection = "to-orphan")}
							>
								{$tStore("batchStudio.orphans.dirToOrphan")}
							</button>
						</div>
					</div>

					{#if isLoadingDetail}
						<p class="lumina-orphan-muted">{$tStore("batchStudio.orphans.loadingRecommendations")}</p>
					{:else if suggestions.length === 0}
						<p class="lumina-orphan-muted">{$tStore("batchStudio.orphans.noRecommendations")}</p>
					{:else}
						<div class="lumina-orphan-rec-list">
							{#each suggestions as rec (rec.path)}
								<div class="lumina-orphan-rec-card">
									<div class="lumina-orphan-rec-card__top">
										<button
											type="button"
											class="lumina-orphan-rec-card__link"
											onclick={() => openNote(rec.path)}
										>
											[[{rec.basename}]]
										</button>
										<div class="lumina-orphan-rec-card__badges">
											<span class="lumina-orphan-pill is-accent">
												{Math.round(rec.score * 100)}%
											</span>
											<span class="lumina-orphan-pill">
												{rec.reason === "rag"
													? $tStore("batchStudio.orphans.reasonRag")
													: $tStore("batchStudio.orphans.reasonKeyword")}
											</span>
											{#if rec.backlinkCount > 0}
												<span class="lumina-orphan-pill">
													↙ {rec.backlinkCount}
												</span>
											{/if}
										</div>
									</div>

									{#if rec.snippet}
										<div class="lumina-orphan-rec-card__snippet">{rec.snippet}</div>
									{/if}

									<div class="lumina-orphan-rec-card__actions">
										<button
											type="button"
											class="lumina-orphan-btn mod-cta"
											disabled={isProcessingAction}
											onclick={() => void handleInsertSingleLink(rec)}
										>
											<span class="lumina-orphan-icon" use:icon={"link"}></span>
											<span>{$tStore("batchStudio.orphans.insertLinkBtn")}</span>
										</button>

										<button
											type="button"
											class="lumina-orphan-btn"
											class:is-locked={!$isProBatch}
											disabled={isProcessingAction || aiLoadingTargetPath === rec.path}
											onclick={() => void handleProposeAiLink(rec)}
										>
											<span class="lumina-orphan-icon" use:icon={"sparkles"}></span>
											<span>
												{aiLoadingTargetPath === rec.path
													? $tStore("batchStudio.orphans.aiGenerating")
													: $tStore("batchStudio.orphans.aiContextLinkBtn")}
											</span>
											{#if !$isProBatch}🔒{/if}
										</button>
									</div>
								</div>
							{/each}
						</div>
					{/if}
				</div>

				<!-- AI 문맥 삽입 Diff 리뷰 박스 (Pro) -->
				{#if aiProposal}
					<div class="lumina-orphan-diff-card">
						<div class="lumina-orphan-diff-card__header">
							<div>
								<strong>{$tStore("batchStudio.orphans.aiProposalTitle")}</strong>
								<div class="lumina-orphan-muted">
									{aiProposal.modifiedFilePath} · {aiProposal.reason}
								</div>
							</div>
							<div class="lumina-orphan-diff-card__btns">
								<button type="button" onclick={() => (aiProposal = null)}>
									{$tStore("common.cancel")}
								</button>
								<button
									type="button"
									class="mod-cta"
									disabled={isProcessingAction}
									onclick={() => void handleApplyAiProposal()}
								>
									{$tStore("batchStudio.orphans.applyProposalBtn")}
								</button>
							</div>
						</div>
						<div class="lumina-orphan-diff-lines">
							{#each aiDiffLines as line, idx (idx)}
								{#if line.type !== "same"}
									<div
										class="lumina-orphan-diff-line"
										class:is-added={line.type === "added"}
										class:is-removed={line.type === "removed"}
									>
										<span>{line.type === "added" ? "+" : "-"}</span>
										<span>{line.text}</span>
									</div>
								{/if}
							{/each}
						</div>
					</div>
				{/if}

				<!-- 본문 미리보기 -->
				<div class="lumina-orphan-section">
					<h4>{$tStore("batchStudio.orphans.previewTitle")}</h4>
					<pre class="lumina-orphan-preview">{previewText || $tStore("batchStudio.orphans.emptyBody")}</pre>
				</div>
			{/if}
		</section>
	</div>
</div>

<style>
	.lumina-orphan-tab {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-height: 0;
		max-width: 100%;
		overflow: hidden;
		overflow-x: hidden;
	}

	.lumina-orphan-toolbar {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		flex-shrink: 0;
	}

	.lumina-orphan-toolbar__row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
	}

	.lumina-orphan-segmented {
		display: inline-flex;
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		overflow: hidden;
	}

	.lumina-orphan-segmented button {
		border: none;
		border-radius: 0;
		background: var(--background-primary);
		color: var(--text-muted);
		font-size: 12px;
		padding: 4px 10px;
		cursor: pointer;
	}

	.lumina-orphan-segmented button.is-active {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		font-weight: 600;
	}

	.lumina-orphan-inline-field,
	.lumina-orphan-check-pill {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		font-size: 12px;
		color: var(--text-muted);
	}

	.lumina-orphan-num-input {
		width: 56px;
		padding: 3px 6px;
		font-size: 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 4px;
		background: var(--background-primary);
		color: var(--text-normal);
	}

	.lumina-orphan-input,
	.lumina-orphan-select {
		padding: 5px 8px;
		font-size: 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		background: var(--background-primary);
		color: var(--text-normal);
	}

	.lumina-orphan-input {
		min-width: 150px;
		flex: 1;
	}

	.lumina-orphan-input.is-folder {
		max-width: 190px;
	}

	.lumina-orphan-btn {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 5px 10px;
		font-size: 12px;
		border-radius: 6px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		color: var(--text-normal);
		cursor: pointer;
	}

	.lumina-orphan-btn.is-locked {
		opacity: 0.78;
	}

	.lumina-orphan-btn.is-danger {
		color: var(--text-error);
	}

	.lumina-orphan-icon {
		display: inline-flex;
		width: 14px;
		height: 14px;
	}

	.lumina-orphan-icon :global(svg) {
		width: 14px;
		height: 14px;
	}

	.lumina-orphan-workbench {
		display: grid;
		grid-template-columns: minmax(270px, 370px) minmax(0, 1fr);
		flex: 1;
		min-height: 0;
		overflow: hidden;
	}

	.lumina-orphan-list-pane {
		display: flex;
		flex-direction: column;
		border-right: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		min-height: 0;
	}

	.lumina-orphan-list-header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px 12px;
		border-bottom: 1px solid var(--background-modifier-border);
		flex-shrink: 0;
	}

	.lumina-orphan-selected-badge {
		font-size: 11px;
		font-weight: 600;
		color: var(--interactive-accent);
	}

	.lumina-orphan-list-scroll {
		flex: 1;
		overflow-y: auto;
		padding: 6px;
		display: flex;
		flex-direction: column;
		gap: 4px;
	}

	.lumina-orphan-item {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 6px 8px;
		border-radius: 6px;
		border: 1px solid transparent;
	}

	.lumina-orphan-item.is-active {
		background: var(--background-primary);
		border-color: var(--interactive-accent);
	}

	.lumina-orphan-item__body {
		flex: 1;
		min-width: 0;
		border: none;
		background: transparent;
		text-align: left;
		padding: 0;
		cursor: pointer;
		color: inherit;
	}

	.lumina-orphan-item__title-row {
		display: flex;
		align-items: center;
		gap: 6px;
	}

	.lumina-orphan-item__title {
		font-size: 13px;
		font-weight: 500;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.lumina-orphan-item__meta {
		display: flex;
		flex-wrap: wrap;
		gap: 4px;
		font-size: 11px;
		color: var(--text-muted);
		margin-top: 2px;
	}

	.lumina-orphan-pill {
		font-size: 10px;
		padding: 1px 6px;
		border-radius: 999px;
		background: var(--background-modifier-border);
		color: var(--text-muted);
	}

	.lumina-orphan-pill.is-accent {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		font-weight: 600;
	}

	.lumina-orphan-pill.is-warn {
		color: var(--text-warning);
	}

	.lumina-orphan-bulk-bar {
		padding: 8px 10px;
		border-top: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
		display: flex;
		flex-direction: column;
		gap: 8px;
		flex-shrink: 0;
	}

	.lumina-orphan-bulk-actions,
	.lumina-orphan-confirm-row {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}

	.lumina-orphan-moc-form {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding-top: 6px;
		border-top: 1px dashed var(--background-modifier-border);
	}

	.lumina-orphan-moc-form__row {
		display: flex;
		gap: 6px;
		justify-content: space-between;
	}

	.lumina-orphan-inspector {
		overflow-y: auto;
		padding: 14px 16px;
		display: flex;
		flex-direction: column;
		gap: 14px;
		min-height: 0;
	}

	.lumina-orphan-inspector__header {
		display: flex;
		align-items: flex-start;
		justify-content: space-between;
		gap: 12px;
	}

	.lumina-orphan-inspector__title {
		margin: 0;
		font-size: 16px;
	}

	.lumina-orphan-inspector__path {
		font-size: 12px;
		color: var(--text-muted);
		word-break: break-all;
	}

	.lumina-orphan-single-actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		padding: 10px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		background: var(--background-secondary);
	}

	.lumina-orphan-archive-group {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 1;
		min-width: 220px;
	}

	.lumina-orphan-section {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.lumina-orphan-section h4 {
		margin: 0;
		font-size: 13px;
		font-weight: 600;
	}

	.lumina-orphan-section__header {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.lumina-orphan-rec-list {
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.lumina-orphan-rec-card {
		display: flex;
		flex-direction: column;
		gap: 6px;
		padding: 10px 12px;
		border: 1px solid var(--background-modifier-border);
		border-radius: 8px;
		background: var(--background-secondary);
	}

	.lumina-orphan-rec-card__top {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
	}

	.lumina-orphan-rec-card__link {
		border: none;
		background: transparent;
		padding: 0;
		color: var(--text-accent);
		font-weight: 600;
		font-size: 13px;
		cursor: pointer;
		text-align: left;
	}

	.lumina-orphan-rec-card__badges,
	.lumina-orphan-rec-card__actions {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px;
	}

	.lumina-orphan-rec-card__snippet {
		font-size: 12px;
		color: var(--text-muted);
		line-height: 1.4;
	}

	.lumina-orphan-diff-card {
		border: 1px solid var(--interactive-accent);
		border-radius: 8px;
		padding: 10px 12px;
		background: var(--background-secondary);
		display: flex;
		flex-direction: column;
		gap: 8px;
	}

	.lumina-orphan-diff-card__header {
		display: flex;
		flex-wrap: wrap;
		justify-content: space-between;
		align-items: center;
		gap: 8px;
	}

	.lumina-orphan-diff-card__btns {
		display: flex;
		gap: 6px;
	}

	.lumina-orphan-diff-lines {
		font-family: var(--font-monospace);
		font-size: 12px;
		display: flex;
		flex-direction: column;
		gap: 3px;
	}

	.lumina-orphan-diff-line {
		display: flex;
		gap: 8px;
		padding: 2px 6px;
		border-radius: 4px;
		white-space: pre-wrap;
		word-break: break-word;
	}

	.lumina-orphan-diff-line.is-added {
		background: rgba(var(--color-green-rgb), 0.14);
	}

	.lumina-orphan-diff-line.is-removed {
		background: rgba(var(--color-red-rgb), 0.14);
	}

	.lumina-orphan-preview {
		margin: 0;
		padding: 10px 12px;
		border-radius: 8px;
		border: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
		font-family: var(--font-monospace);
		font-size: 12px;
		white-space: pre-wrap;
		word-break: break-word;
		max-height: 240px;
		overflow-y: auto;
	}

	.lumina-orphan-muted {
		font-size: 12px;
		color: var(--text-muted);
		margin: 0;
	}

	.lumina-orphan-empty {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		text-align: center;
		padding: 28px 16px;
		color: var(--text-muted);
		gap: 8px;
	}

	.lumina-orphan-empty__icon {
		width: 24px;
		height: 24px;
	}

	:global(body.is-mobile) .lumina-orphan-toolbar {
		max-height: 150px;
		overflow-y: auto;
		padding: 8px 10px;
	}

	:global(body.is-mobile) .lumina-orphan-input,
	:global(body.is-mobile) .lumina-orphan-input.is-folder,
	:global(body.is-mobile) .lumina-orphan-archive-group {
		min-width: 0;
		max-width: 100%;
	}

	:global(body.is-mobile) .lumina-orphan-workbench {
		grid-template-columns: 1fr;
		grid-template-rows: minmax(200px, 44%) minmax(0, 1fr);
	}

	:global(body.is-mobile) .lumina-orphan-list-pane {
		border-right: none;
		border-bottom: 1px solid var(--background-modifier-border);
	}
</style>
