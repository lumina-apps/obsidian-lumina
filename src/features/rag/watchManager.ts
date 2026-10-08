import type LuminaPlugin from '../../main';
import { debugLogger } from '../../shared/debugLogger';
import { normalizeError } from '../../shared/utils/errorUtils';
import { TFile, type EventRef, type TAbstractFile } from 'obsidian';
import { SUPPORTED_EXTENSIONS } from './parsers/DocumentParserRouter';
import { isExcluded, isIncluded } from './exclusions';
import { getActiveProject } from '../../core/store/projectStore';

export class RagWatchManager {
	private plugin: LuminaPlugin;
	private watchDebounceTimer: number | null = null;
	private watchEventRefs: EventRef[] = [];

	constructor(plugin: LuminaPlugin) {
		this.plugin = plugin;
	}

	/** 파일이 RAG 인덱싱 대상인지 가볍게 사전 필터링합니다. */
	private isRelevantFile(file: TAbstractFile): boolean {
		if (!(file instanceof TFile)) return false;
		if (file.path.startsWith('.') || file.path.includes('/.')) return false;

		const ext = file.extension?.toLowerCase();
		if (!ext || !SUPPORTED_EXTENSIONS.has(ext)) return false;

		const activeProject = getActiveProject();
		const configDir = this.plugin.app.vault.configDir;
		const finalExcludedPaths = [...(activeProject.ragExcludedPaths || [])];
		if (configDir && !finalExcludedPaths.includes(configDir)) {
			finalExcludedPaths.push(configDir);
		}
		const chatHistoryPath = this.plugin.settings.chat.historyPath;
		if (chatHistoryPath && !finalExcludedPaths.includes(chatHistoryPath)) {
			finalExcludedPaths.push(chatHistoryPath);
		}

		if (isExcluded(file.path, finalExcludedPaths)) return false;
		if (!isIncluded(file.path, activeProject.ragIncludedPaths || [])) return false;

		const maxSizeBytes = this.plugin.settings.rag.maxFileSizeMB > 0
			? this.plugin.settings.rag.maxFileSizeMB * 1024 * 1024
			: 0;
		if (maxSizeBytes > 0 && file.stat && file.stat.size > maxSizeBytes) {
			return false;
		}

		return true;
	}

	/**
	 * vault.on('modify', 'create', 'delete', 'rename') 이벤트로 파일 변경 감지 + 2초 디바운스 후 증분 인덱싱.
	 * syncMode='watch' 일 때만 등록합니다.
	 */
	public registerWatchEvents(): void {
		this.clearWatchEvents();

		const scheduleUpdate = () => {
			if (this.watchDebounceTimer) window.clearTimeout(this.watchDebounceTimer);
			this.watchDebounceTimer = window.setTimeout(() => {
				void (async () => {
					if (!this.plugin.indexer) return;
					try {
						await this.plugin.indexer.updateIndex();
					} catch (err) {
						debugLogger.logError(
							'rag',
							normalizeError(err, `watch 인덱싱 실패: ${err}`),
						);
					}
				})();
			}, 2000);
		};

		const modifyRef = this.plugin.app.vault.on('modify', (file: TAbstractFile) => {
			if (this.isRelevantFile(file)) scheduleUpdate();
		});
		const createRef = this.plugin.app.vault.on('create', (file: TAbstractFile) => {
			if (this.isRelevantFile(file)) scheduleUpdate();
		});
		const deleteRef = this.plugin.app.vault.on('delete', (file: TAbstractFile) => {
			if (file instanceof TFile) {
				if (this.plugin.indexer?.indexedPaths.has(file.path) || this.isRelevantFile(file)) {
					scheduleUpdate();
				}
			} else {
				// 폴더 삭제: 인덱싱된 파일 중 해당 폴더 하위 파일이 포함되어 있는지 확인
				const folderPrefix = file.path.endsWith('/') ? file.path : file.path + '/';
				const hasIndexedChild = Boolean(
					this.plugin.indexer &&
					Array.from(this.plugin.indexer.indexedPaths).some(p => p.startsWith(folderPrefix))
				);
				if (hasIndexedChild) {
					scheduleUpdate();
				}
			}
		});
		const renameRef = this.plugin.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
			if (file instanceof TFile) {
				if (this.plugin.indexer?.indexedPaths.has(oldPath) || this.isRelevantFile(file)) {
					scheduleUpdate();
				}
			} else {
				// 폴더 이름 변경: 이전 폴더 하위 파일이 인덱싱되어 있었거나 대상이 될 수 있는 폴더인지 확인
				const oldPrefix = oldPath.endsWith('/') ? oldPath : oldPath + '/';
				const hasIndexedChild = Boolean(
					this.plugin.indexer &&
					Array.from(this.plugin.indexer.indexedPaths).some(p => p.startsWith(oldPrefix))
				);
				if (hasIndexedChild || (!file.path.startsWith('.') && !file.path.includes('/.'))) {
					scheduleUpdate();
				}
			}
		});

		this.watchEventRefs.push(modifyRef, createRef, deleteRef, renameRef);
	}

	/** watch 이벤트 및 타이머 정리 */
	public clearWatchEvents(): void {
		if (this.watchDebounceTimer) {
			window.clearTimeout(this.watchDebounceTimer);
			this.watchDebounceTimer = null;
		}

		for (const ref of this.watchEventRefs) {
			this.plugin.app.vault.offref(ref);
		}
		this.watchEventRefs = [];
	}
}
