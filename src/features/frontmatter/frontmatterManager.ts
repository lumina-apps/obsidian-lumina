/** 프론트매터 자동 생성 모듈. 생성/수정 시 luminaCreated, luminaModified, luminaVersion, tags 관리 */

import { App, TFile, type EventRef } from 'obsidian';
import { isMarkdownFile } from '../../shared/utils/fileUtils';
import { debugLogger } from '../../shared/debugLogger';
import { createProvider } from '../../core/llm-providers';
import type LuminaPlugin from '../../main';

/** processFrontMatter용 프론트매터 구조 */
interface LuminaFrontmatter {
	luminaCreated?: string;
	luminaModified?: string;
	luminaVersion?: string;
	tags?: string | string[];
	description?: string;
}

/** 두 값이 깊은 동등인지 비교 (프론트매터의 원시값/배열/객체 비교용) */
function deepEqual(a: unknown, b: unknown): boolean {
	if (a === b) return true;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		return a.every((v, i) => deepEqual(v, b[i]));
	}
	if (a !== null && b !== null && typeof a === 'object' && typeof b === 'object') {
		const keysA = Object.keys(a);
		const keysB = Object.keys(b);
		if (keysA.length !== keysB.length) return false;
		return keysA.every(k => deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
	}
	return false;
}

/** 프론트매터 자동생성 상태와 이벤트 등록/해제를 캡슐화 */
export class FrontmatterManager {
	private plugin: LuminaPlugin;
	private app: App;

	private generatingFiles: Set<string> = new Set();
	private lastUpdateMap: Map<string, number> = new Map();
	/** 현재 보고 있는 파일 경로 (자동 병합 알림 방지) */
	private activeFilePath: string | null = null;
	/** 탭 전환 시 업데이트할 대기열 */
	private pendingUpdates: Set<string> = new Set();
	/** LLM 자동생성 디바운스 타이머 */
	private llmDebounceTimers: Map<string, number> = new Map();
	/** LLM 생성 데이터 캐시 */
	private llmGeneratedCache: Map<string, { tags: string[], description: string }> = new Map();
	/** 등록된 이벤트 참조 (해제용) */
	private eventRefs: EventRef[] = [];

	constructor(plugin: LuminaPlugin) {
		this.plugin = plugin;
		this.app = plugin.app;
	}

	// ── Public API ────────────────────────────────────────────────────────

	/** 프론트매터 자동생성 활성화 여부에 따라 이벤트 등록 */
	registerIfEnabled(): void {
		if (this.plugin.settings.misc.autoFrontmatter) {
			this.registerEvents();
		}
	}

	/** 프론트매터 자동생성 이벤트 리스닝 등록 */
	registerEvents(): void {
		this.clearEvents();

		const activeFile = this.app.workspace.getActiveFile();
		this.activeFilePath = activeFile ? activeFile.path : null;

		const refFileOpen = this.app.workspace.on('file-open', (file) => {
			this.activeFilePath = file ? file.path : null;
			void this.processPendingUpdates();
		});
		this.plugin.registerEvent(refFileOpen);
		this.eventRefs.push(refFileOpen);

		const refCreate = this.app.vault.on('create', (file) => {
			if (isMarkdownFile(file)) {
				this.autoGenerate(file, false).catch(console.error);
			}
		});
		this.plugin.registerEvent(refCreate);
		this.eventRefs.push(refCreate);

		const refModify = this.app.vault.on('modify', (file) => {
			if (!isMarkdownFile(file)) return;

			// 플러그인이 수정한 직후 발생하는 modify 이벤트는 무시 (1.5초 이내)
			const lastUpdate = this.lastUpdateMap.get(file.path) || 0;
			if (Date.now() - lastUpdate < 1500) return;

			// 자동 프론트매터는 사용자가 직접 보고 편집 중인 파일에만 적용한다.
			// 볼트 전체 modify 이벤트에 반응하면 다른 플러그인/동기화가 건드린
			// 노트까지 재작성되어 mtime·Syncthing 충돌·백그라운드 재인덱싱을 유발한다.
			if (this.activeFilePath !== file.path) return;

			// 현재 보고 있는 파일이면 업데이트를 대기열에 넣음 (자동 병합 알림 방지)
			this.pendingUpdates.add(file.path);

			// LLM 자동생성 디바운스 설정 (8초)
			if (this.llmDebounceTimers.has(file.path)) {
				window.clearTimeout(this.llmDebounceTimers.get(file.path));
			}
			const timer = window.setTimeout(() => {
				this.llmDebounceTimers.delete(file.path);
				this.generateFrontmatterData(file).catch(console.error);
			}, 8000);
			this.llmDebounceTimers.set(file.path, timer);
		});
		this.plugin.registerEvent(refModify);
		this.eventRefs.push(refModify);

		const refRename = this.app.vault.on('rename', (file, oldPath) => {
			if (this.lastUpdateMap.has(oldPath)) {
				const val = this.lastUpdateMap.get(oldPath)!;
				this.lastUpdateMap.delete(oldPath);
				this.lastUpdateMap.set(file.path, val);
			}
			if (this.pendingUpdates.has(oldPath)) {
				this.pendingUpdates.delete(oldPath);
				this.pendingUpdates.add(file.path);
			}
		});
		this.plugin.registerEvent(refRename);
		this.eventRefs.push(refRename);

		const refDelete = this.app.vault.on('delete', (file) => {
			this.lastUpdateMap.delete(file.path);
			this.pendingUpdates.delete(file.path);
			this.llmGeneratedCache.delete(file.path);
			if (this.llmDebounceTimers.has(file.path)) {
				window.clearTimeout(this.llmDebounceTimers.get(file.path));
				this.llmDebounceTimers.delete(file.path);
			}
		});
		this.plugin.registerEvent(refDelete);
		this.eventRefs.push(refDelete);
	}

	/** 등록된 프론트매터 이벤트 모두 해제 */
	clearEvents(): void {
		for (const ref of this.eventRefs) {
			this.app.vault.offref(ref);
		}
		this.eventRefs = [];
		this.pendingUpdates.clear();
		this.lastUpdateMap.clear();
		this.llmGeneratedCache.clear();
		for (const timer of this.llmDebounceTimers.values()) {
			window.clearTimeout(timer);
		}
		this.llmDebounceTimers.clear();
	}

	/** 완전한 파괴 (onunload) */
	destroy(): void {
		this.clearEvents();
	}

	/** lumina* 키가 하나라도 있는 마크다운 파일 수 (메타데이터 캐시 기반, 동기) */
	countLuminaStampedFiles(): number {
		let count = 0;
		for (const file of this.app.vault.getMarkdownFiles()) {
			const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
			if (fm && ('luminaCreated' in fm || 'luminaModified' in fm || 'luminaVersion' in fm)) {
				count++;
			}
		}
		return count;
	}

	/** 볼트 전체 마크다운 파일에서 luminaCreated/luminaModified/luminaVersion 키를 제거한다. */
	async stripLuminaMetadata(
		onProgress?: (done: number, total: number) => void,
		isCancelled?: () => boolean,
	): Promise<number> {
		const files = this.app.vault.getMarkdownFiles();
		const total = files.length;
		let stripped = 0;
		let done = 0;

		for (const file of files) {
			if (isCancelled && isCancelled()) break;
			try {
				const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
				if (fm && ('luminaCreated' in fm || 'luminaModified' in fm || 'luminaVersion' in fm)) {
					await this.app.fileManager.processFrontMatter(file, (fmObj) => {
						const r = fmObj as Record<string, unknown>;
						delete r.luminaCreated;
						delete r.luminaModified;
						delete r.luminaVersion;
					});
					stripped++;
				}
			} catch {
				// 개별 파일의 프론트매터 파싱 오류 등은 무시하고 계속 진행
			}
			done++;
			if (onProgress && (done % 10 === 0 || done === total)) onProgress(done, total);
		}

		return stripped;
	}

	// ── Private helpers ────────────────────────────────────────────────────
	
	/** Task 모델을 호출해 프론트매터 데이터 생성 후 캐시에 저장 */
	private async generateFrontmatterData(file: TFile): Promise<void> {
		const { taskProviderId, taskModelId, providers } = this.plugin.settings.connections;
		if (!taskProviderId || !taskModelId) return;

		const providerConfig = providers.find(p => p.id === taskProviderId);
		if (!providerConfig) return;

		try {
			// 본문만 읽기 (토큰 절약을 위해 프론트매터 제거)
			const fullContent = await this.app.vault.read(file);
			const contentWithoutFm = fullContent.replace(/^---[\s\S]+?---\n/, '').trim();
			if (contentWithoutFm.length < 50) return; // 내용이 너무 짧으면 무시

			const prompt = `다음 마크다운 문서를 분석하여 핵심 태그 3개 이내와 1문장 요약(description)을 JSON 형식으로 반환해.
반드시 아래 JSON 포맷을 지키고 다른 말은 하지 마.
{
  "tags": ["태그1", "태그2"],
  "description": "문서의 핵심 내용 1문장 요약"
}

문서 내용:
${contentWithoutFm.substring(0, 3000)}`;

			const provider = createProvider(providerConfig);
			const response = await provider.chat([{ role: 'user', content: prompt }], {
				model: taskModelId,
				temperature: 0.1,
				maxOutputTokens: 150
			});

			const match = response.content.match(/\{[\s\S]*\}/);
			if (match) {
				const data: unknown = JSON.parse(match[0]);
				if (
					typeof data === 'object' &&
					data !== null &&
					'tags' in data &&
					'description' in data &&
					Array.isArray((data as Record<string, unknown>).tags) &&
					typeof (data as Record<string, unknown>).description === 'string'
				) {
					const parsed = data as { tags: string[]; description: string };
					this.llmGeneratedCache.set(file.path, {
						tags: parsed.tags,
						description: parsed.description
					});
					debugLogger.logMcp('Frontmatter', 'Generated LLM data cached for ' + file.path);
					
					// 생성 완료 시점에 현재 파일이 비활성화 상태라면 대기열 처리를 놓쳤을 수 있으므로 즉시 반영
					if (this.activeFilePath !== file.path) {
						await this.autoGenerate(file, true);
					}
				}
			}
		} catch (error) {
			debugLogger.logError('system', new Error(`LLM 프론트매터 생성 실패: ${error}`));
		}
	}

	/** processFrontMatter로 파일별 프론트매터 생성/갱신 (의미 있는 변경이 있을 때만 재기록) */
	private async autoGenerate(file: TFile, isUpdate: boolean): Promise<void> {
		if (!this.plugin.settings.misc.autoFrontmatter) return;

		if (this.generatingFiles.has(file.path)) return;
		this.generatingFiles.add(file.path);

		try {
			const cache = this.app.metadataCache.getFileCache(file);
			const currentFm = (cache?.frontmatter ?? {}) as Record<string, unknown>;
			const now = new Date().toISOString();
			const version = this.plugin.manifest.version;

			// 적용할 프론트매터를 먼저 계산한다 (실제로 변경된 경우에만 재기록).
			const targetFm: Record<string, unknown> = { ...currentFm };

			if (!isUpdate) {
				targetFm.luminaCreated = (targetFm.luminaCreated as string | undefined) || now;
				if (typeof targetFm.tags === 'string') {
					targetFm.tags = (targetFm.tags as string)
						.split(',')
						.map((t: string) => t.trim())
						.filter((t: string) => t.length > 0);
				} else if (!Array.isArray(targetFm.tags)) {
					targetFm.tags = [];
				}
			}

			// LLM 캐시가 있다면 적용
			const cachedData = this.llmGeneratedCache.get(file.path);
			if (cachedData) {
				targetFm.description = cachedData.description;

				let existingTags: string[] = [];
				if (Array.isArray(targetFm.tags)) {
					existingTags = targetFm.tags as string[];
				} else if (typeof targetFm.tags === 'string') {
					existingTags = (targetFm.tags as string).split(',').map(t => t.trim()).filter(t => t.length > 0);
				}
				targetFm.tags = Array.from(new Set([...existingTags, ...cachedData.tags]));

				this.llmGeneratedCache.delete(file.path);
			}

			targetFm.luminaVersion = version;

			// luminaModified 단순 타임스탬프 갱신만으로는 재기록하지 않는다 (mtime 보존).
			// luminaCreated/luminaVersion/tags/description 중 실제 변경이 있을 때만 쓴다.
			const managed: (keyof LuminaFrontmatter)[] = ['luminaCreated', 'luminaModified', 'luminaVersion', 'tags', 'description'];
			const hasMeaningfulChange = managed.some(k => !deepEqual(currentFm[k], targetFm[k]));
			if (!hasMeaningfulChange) {
				this.lastUpdateMap.set(file.path, Date.now());
				return; // 변경 없음 → 파일을 건드리지 않음
			}

			targetFm.luminaModified = now;

			await this.app.fileManager.processFrontMatter(file, (fmObj) => {
				const fm = fmObj as Record<string, unknown>;
				for (const k of managed) {
					if (k in targetFm) {
						fm[k] = targetFm[k];
					} else {
						delete fm[k];
					}
				}
			});

			this.lastUpdateMap.set(file.path, Date.now());
		} catch (err) {
			debugLogger.logError('system', err instanceof Error ? err : new Error(`프론트매터 자동생성 실패: ${err}`));
		} finally {
			this.generatingFiles.delete(file.path);
		}
	}

	/** 탭 전환 시 대기 중인 프론트매터 업데이트 일괄 처리 */
	private async processPendingUpdates(): Promise<void> {
		for (const path of this.pendingUpdates) {
			if (path === this.activeFilePath) continue;

			const file = this.app.vault.getAbstractFileByPath(path);
			if (file && isMarkdownFile(file)) {
				this.pendingUpdates.delete(path);
				await this.autoGenerate(file, true).catch(console.error);
			} else {
				this.pendingUpdates.delete(path);
			}
		}
	}
}