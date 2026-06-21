import type LuminaPlugin from '../../main';
import { debugLogger } from '../../shared/debugLogger';
import type { EventRef } from 'obsidian';

export class RagWatchManager {
	private plugin: LuminaPlugin;
	private watchDebounceTimer: number | null = null;
	private watchEventRefs: EventRef[] = [];

	constructor(plugin: LuminaPlugin) {
		this.plugin = plugin;
	}

	/**
	 * vault.on('modify', 'create', 'delete', 'rename') 이벤트로 파일 변경 감지 + 2초 디바운스 후 증분 인덱싱.
	 * syncMode='watch' 일 때만 등록합니다.
	 */
	public registerWatchEvents(): void {
		this.clearWatchEvents();

		const triggerUpdate = () => {
			if (this.watchDebounceTimer) window.clearTimeout(this.watchDebounceTimer);
			this.watchDebounceTimer = window.setTimeout(() => {
				void (async () => {
					if (!this.plugin.indexer) return;
					try {
						await this.plugin.indexer.updateIndex();
					} catch (err) {
						debugLogger.logError(
							'rag',
							err instanceof Error ? err : new Error(`watch 인덱싱 실패: ${err}`),
						);
					}
				})();
			}, 2000);
		};

		const modifyRef = this.plugin.app.vault.on('modify', triggerUpdate);
		const createRef = this.plugin.app.vault.on('create', triggerUpdate);
		const deleteRef = this.plugin.app.vault.on('delete', triggerUpdate);
		const renameRef = this.plugin.app.vault.on('rename', triggerUpdate);

		this.watchEventRefs.push(modifyRef, createRef, deleteRef, renameRef);

		this.plugin.registerEvent(modifyRef);
		this.plugin.registerEvent(createRef);
		this.plugin.registerEvent(deleteRef);
		this.plugin.registerEvent(renameRef);
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
