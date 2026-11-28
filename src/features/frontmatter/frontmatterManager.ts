/** 프론트매터 자동 생성 모듈. AI 기반 tags, description 자동 생성 및 기존 lumina* 잔여 메타데이터 정리를 담당 */

import { App, Platform, TFile, type EventRef } from 'obsidian';
import { get } from 'svelte/store';
import { isMarkdownFile } from '../../shared/utils/fileUtils';
import { isExcluded } from '../../shared/utils/exclusions';
import { mergeExcludedPathsWithHistory } from '../../shared/utils/historyPathUtils';
import { activeProject } from '../../core/store/projectStore';
import { debugLogger } from '../../shared/debugLogger';
import { normalizeError } from '../../shared/utils/errorUtils';
import { stripThinkTags } from '../../shared/utils/llmTextSanitizer';
import {
	FRONTMATTER_RESPONSE_FORMAT,
	sanitizeGeneratedFrontmatterData,
} from '../../shared/utils/frontmatterSanitizer';
import { findSupportedProvider } from '../../shared/utils/modelUtils';
import { createProvider } from '../../core/llm-providers';
import { StripFrontmatterModal } from './stripFrontmatterModal';
import type LuminaPlugin from '../../main';

/** 사고/추론 토큰을 사용하는 모델에서도 JSON 응답이 잘리지 않도록 여유 출력 한도 부여 */
const FRONTMATTER_MAX_OUTPUT_TOKENS = 1000;

/** processFrontMatter용 프론트매터 구조 */
interface LuminaFrontmatter {
	tags?: string | string[];
	description?: string;
}

export { sanitizeGeneratedFrontmatterData };

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
	/** 등록된 이벤트 참조 (볼트 이벤트 해제용) */
	private eventRefs: EventRef[] = [];
	/** 등록된 워크스페이스 이벤트 참조 (워크스페이스 이벤트 해제용) */
	private workspaceEventRefs: EventRef[] = [];
	/** 모바일 백그라운드 전환 시 대기 중인 프론트매터 플러시 리스너 */
	private visibilityHandler: (() => void) | null = null;

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
		this.workspaceEventRefs.push(refFileOpen);

		const refCreate = this.app.vault.on('create', (file) => {
			if (isMarkdownFile(file) && !this.isExcludedPath(file.path)) {
				// 폴더 자동감시가 동일 파일의 frontmatter 생성을 담당 중이면 중복 LLM 호출 방지
				if (this.plugin.folderWatchManager?.isPathManagedForFrontmatter(file.path)) {
					return;
				}
				this.autoGenerate(file, false).catch((err: unknown) => {
					debugLogger.logError('frontmatter', err instanceof Error ? err : String(err));
				});
			}
		});
		this.plugin.registerEvent(refCreate);
		this.eventRefs.push(refCreate);

		const refModify = this.app.vault.on('modify', (file) => {
			if (!isMarkdownFile(file) || this.isExcludedPath(file.path)) return;
			if (this.plugin.folderWatchManager?.isPathManagedForFrontmatter(file.path)) return;

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
				this.generateFrontmatterData(file).catch((err: unknown) => {
					debugLogger.logError('frontmatter', err instanceof Error ? err : String(err));
				});
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

		if (typeof Platform !== 'undefined' && Platform?.isMobile && typeof document !== 'undefined') {
			// 모바일에서는 앱 전환 시 file-open 없이 백그라운드로 내려가므로 hidden 시점에 대기열 플러시
			this.visibilityHandler = () => {
				if (document.visibilityState === 'hidden') {
					void this.processPendingUpdates();
				}
			};
			document.addEventListener('visibilitychange', this.visibilityHandler);
		}
	}

	/** 현재 활성 프로젝트·채팅 히스토리·기본 제외 경로 포함 여부를 판별합니다. */
	private isExcludedPath(filePath: string): boolean {
		const projectExcluded = get(activeProject)?.ragExcludedPaths ?? [];
		const mergedExcluded = mergeExcludedPathsWithHistory(
			projectExcluded,
			this.plugin.settings?.chat?.historyPath,
		);
		return isExcluded(filePath, mergedExcluded);
	}

	/** 등록된 프론트매터 이벤트 모두 해제 */
	clearEvents(): void {
		for (const ref of this.workspaceEventRefs) {
			this.app.workspace?.offref?.(ref);
		}
		this.workspaceEventRefs = [];
		for (const ref of this.eventRefs) {
			this.app.vault?.offref?.(ref);
		}
		this.eventRefs = [];
		if (this.visibilityHandler && typeof document !== 'undefined') {
			document.removeEventListener('visibilitychange', this.visibilityHandler);
			this.visibilityHandler = null;
		}
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

	/** lumina 메타데이터 일괄 제거 확인 모달을 엽니다. */
	openStripMetadataModal(count: number, onConfirm: () => void | Promise<void>): void {
		new StripFrontmatterModal(this.app, count, onConfirm).open();
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

		const providerConfig = findSupportedProvider(providers, taskProviderId);
		if (!providerConfig || !providerConfig.isVerified) return;

		try {
			// 본문만 읽기 (토큰 절약을 위해 프론트매터 제거)
			const fullContent = await this.app.vault.read(file);
			const contentWithoutFm = fullContent.replace(/^---[\s\S]+?---\r?\n/, '').trim();
			if (contentWithoutFm.length < 50) return; // 내용이 너무 짧으면 무시

			const prompt = `Analyze the following markdown document and return 1 to 3 relevant topic tags and a 1-sentence summary (description) in JSON format.
CRITICAL RULES:
1. Write the tags and description in the EXACT SAME LANGUAGE as the document content (e.g., Korean for Korean notes, English for English notes).
2. Tags MUST be specific, meaningful keywords/topics derived directly from the document content (without a leading "#").
3. NEVER copy placeholder strings such as "tag1", "tag2", "tag", "example", or template descriptions verbatim.
4. Output ONLY a valid JSON object matching this schema with no additional text or markdown fences:
{"tags": ["<specific topic from note>"], "description": "<1-sentence summary in the note's language>"}

Document Content:
${contentWithoutFm.substring(0, 3000)}`;

			const reqStart = Date.now();
			const requestId = debugLogger.logRequest({
				provider: providerConfig.type,
				model: taskModelId,
				temperature: 0.1,
				maxTokens: FRONTMATTER_MAX_OUTPUT_TOKENS,
				stream: false,
				systemPrompt: `[Auto Frontmatter — ${file.path}]`,
				messages: [{ role: 'user', content: prompt }],
			});

			const provider = createProvider(providerConfig);
			let response: import('../../shared/types/llm.types').ChatResponse;
			try {
				response = await provider.chat([{ role: 'user', content: prompt }], {
					model: taskModelId,
					temperature: 0.1,
					maxOutputTokens: FRONTMATTER_MAX_OUTPUT_TOKENS,
					responseFormat: FRONTMATTER_RESPONSE_FORMAT,
					reasoning: { effort: 'off' },
					ttftTimeoutMs: 15000,
					interTokenTimeoutMs: 10000,
				});
				debugLogger.logResponse(requestId, {
					model: taskModelId,
					content: response.content,
					durationMs: Date.now() - reqStart,
					usage: response.usage,
					...(response.finishReason ? { stopReason: response.finishReason } : {}),
				});
			} catch (chatErr) {
				debugLogger.logResponse(requestId, {
					model: taskModelId,
					content: `❌ [Error] ${chatErr instanceof Error ? chatErr.message : String(chatErr)}`,
					durationMs: Date.now() - reqStart,
					stopReason: 'error',
				});
				throw chatErr;
			}

			const cleanedContent = stripThinkTags(
				response.content
					.replace(/&lt;think&gt;/gi, '<think>')
					.replace(/&lt;\/think&gt;/gi, '</think>'),
			);
			const match = cleanedContent.match(/\{[\s\S]*\}/);
			if (match) {
				const data: unknown = JSON.parse(match[0]);
				const sanitized = sanitizeGeneratedFrontmatterData(data);
				if (sanitized) {
					this.llmGeneratedCache.set(file.path, sanitized);
					debugLogger.logSystem('frontmatter', `Generated LLM data cached for ${file.path}`);
					
					// 생성 완료 시점에 현재 파일이 비활성화 상태라면 대기열 처리를 놓쳤을 수 있으므로 즉시 반영
					if (this.activeFilePath !== file.path) {
						await this.autoGenerate(file, true);
					}
				}
			}
		} catch (error) {
			debugLogger.logError('frontmatter', normalizeError(error, `LLM 프론트매터 생성 실패: ${error}`));
		}
	}

	/** processFrontMatter로 LLM이 생성한 tags/description 프론트매터를 반영 (실제 변경이 있을 때만 기록) */
	private async autoGenerate(file: TFile, _isUpdate: boolean): Promise<void> {
		if (!this.plugin.settings.misc.autoFrontmatter) return;

		if (this.generatingFiles.has(file.path)) return;
		this.generatingFiles.add(file.path);

		try {
			const cachedData = this.llmGeneratedCache.get(file.path);
			if (!cachedData) {
				return; // LLM이 생성한 태그/요약 데이터가 없으면 파일을 건드리지 않음
			}

			const cache = this.app.metadataCache.getFileCache(file);
			const currentFm = (cache?.frontmatter ?? {}) as Record<string, unknown>;

			// 적용할 프론트매터를 먼저 계산한다 (실제로 변경된 경우에만 재기록).
			const targetFm: Record<string, unknown> = { ...currentFm };
			if (cachedData.description) {
				targetFm.description = cachedData.description;
			}

			if (cachedData.tags.length > 0) {
				let existingTags: string[] = [];
				if (Array.isArray(targetFm.tags)) {
					existingTags = targetFm.tags as string[];
				} else if (typeof targetFm.tags === 'string') {
					existingTags = targetFm.tags.split(',').map(t => t.trim()).filter(t => t.length > 0);
				}
				targetFm.tags = Array.from(new Set([...existingTags, ...cachedData.tags]));
			}

			this.llmGeneratedCache.delete(file.path);

			const managed: (keyof LuminaFrontmatter)[] = ['tags', 'description'];
			const hasMeaningfulChange = managed.some(k => !deepEqual(currentFm[k], targetFm[k]));
			if (!hasMeaningfulChange) {
				this.lastUpdateMap.set(file.path, Date.now());
				return; // 변경 없음 → 파일을 건드리지 않음
			}

			await this.app.fileManager.processFrontMatter(file, (fmObj) => {
				const fm = fmObj as Record<string, unknown>;
				for (const k of managed) {
					if (k in targetFm) {
						fm[k] = targetFm[k];
					}
				}
			});

			this.lastUpdateMap.set(file.path, Date.now());
		} catch (err) {
			debugLogger.logError('system', normalizeError(err, `프론트매터 자동생성 실패: ${err}`));
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
				await this.autoGenerate(file, true).catch((err: unknown) => {
					debugLogger.logError('frontmatter', err instanceof Error ? err : String(err));
				});
			} else {
				this.pendingUpdates.delete(path);
			}
		}
	}
}