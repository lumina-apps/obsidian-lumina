import { Notice, type App } from 'obsidian';
import { get } from 'svelte/store';
import { t } from '../../../shared/locales/helpers';
import type { ContextAttachment, UIChatMessage } from '../../../shared/types/chat.types';
import type LuminaPlugin from '../../../main';
import type { LLMProviderConfig } from '../../../shared/types/settings.types';
import type { ChatMessage, ToolDefinition } from '../../../shared/types/llm.types';
import type { RagChunkMeta } from '../../../shared/types/debug.types';
import { VISION_UNSUPPORTED_PROVIDERS, PROVIDER_LABELS, isCliProvider } from '../../../shared/types/settings.types';
import { isLocalProvider } from '../../../core/llm-providers/index';
import { indexingState } from '../../../core/store/ragStore';
import { sessionSummary, summaryUpToMessageId } from '../../../core/store/chatStore';
import { buildMessages } from '../promptBuilder';
import { ChatAttachmentHandler, IMAGE_EXTENSIONS } from './ChatAttachmentHandler';
import { resolveRagSearchFlag, performRagSearch } from './ragSearchHelper';
import { collectMcpTools, injectToolPrompts } from './mcpToolHelper';
import { injectMultimodalImages } from './multimodalHelper';
import { collectWebSearchTool } from './webSearchToolHelper';

export interface ResolvedContext {
	llmMessages: ChatMessage[];
	ragChunksForLog: RagChunkMeta[] | undefined;
	useTextTools: boolean;
	mcpTools: ToolDefinition[];
	toolServerMap: Record<string, string>;
	attachments?: ContextAttachment[];
}

/**
 * includeActiveNote가 활성화된 경우 attachments에 active_note를 추가한다.
 * 이미 포함된 경우 중복 추가하지 않는다.
 */
export async function resolveAttachmentsWithActiveNote(
	app: App,
	attachments: ContextAttachment[],
	includeActiveNote: boolean,
): Promise<ContextAttachment[]> {
	if (!includeActiveNote) return [...attachments];

	const activeFile = app.workspace.getActiveFile();
	if (!activeFile) return [...attachments];

	const alreadyIncluded = attachments.some(
		att => att.type === 'active_note' || (att.type === 'file' && att.path === activeFile.path),
	);
	if (alreadyIncluded) return [...attachments];

	return [
		...attachments,
		{
			type: 'active_note',
			path: activeFile.path,
			name: t('settings.chat.context.activeNote', { name: activeFile.basename }),
		},
	];
}

/**
 * 컨텍스트(첨부파일 + RAG)와 LLM 메시지를 구성한다.
 * attachmentContext 생성, RAG 검색, 프롬프트 빌드, 툴/멀티모달 주입까지 일괄 처리.
 */
export async function buildLlmContext(
	plugin: LuminaPlugin,
	userText: string,
	updatedAttachments: ContextAttachment[],
	history: UIChatMessage[],
	providerConfig: LLMProviderConfig,
	resolvedModelId: string,
	chatSettings: LuminaPlugin['settings']['chat'],
	ragSettings: LuminaPlugin['settings']['rag'],
	ragEnabled: boolean,
	useRagContext: boolean | undefined,
	assistantId: string,
	signal?: AbortSignal,
): Promise<ResolvedContext> {
	// RAG 벡터 검색
	const shouldSearchRag = resolveRagSearchFlag({
		ragEnabled,
		useRagContext,
	});
	const isRagReady = shouldSearchRag && !!plugin.indexer && get(indexingState).status === 'ready';

	// RAG 인덱서에 실제로 청크가 존재하는 폴더만 RAG 검색으로 위임하고, 미인덱싱 폴더는 직접 읽기로 폴백
	const ragFilterFolders: string[] = [];
	if (isRagReady && plugin.indexer) {
		const indexedChunks = plugin.indexer.indexedParentChunks;
		for (const att of updatedAttachments) {
			if (
				att.type === 'folder' &&
				indexedChunks.some(c => c.path === att.path || c.path.startsWith(att.path + '/'))
			) {
				ragFilterFolders.push(att.path);
			}
		}
	}
	const ragFilterFolderSet = new Set(ragFilterFolders);
	const attachmentsForDirectRead = updatedAttachments.filter(
		att => !(att.type === 'folder' && ragFilterFolderSet.has(att.path)),
	);

	// 첨부파일 컨텍스트 빌드
	let { attachmentContext, multimodalImages, failedAttachments } =
		await ChatAttachmentHandler.buildAttachmentContext(plugin.app, attachmentsForDirectRead, plugin, { skipFolders: false });

	if (failedAttachments && failedAttachments.length > 0) {
		new Notice(t('uiMessages.attachmentsSkipped', { files: failedAttachments.join(', ') }));
	}

	// 최근 대화 턴(요약 이후 최대 3턴)의 텍스트 기반 첨부파일 컨텍스트 복원
	const currentSummaryUpToId = get(summaryUpToMessageId);
	let effectiveHistory = history;
	if (currentSummaryUpToId) {
		const summaryIdx = history.findIndex(m => m.id === currentSummaryUpToId);
		if (summaryIdx !== -1) {
			effectiveHistory = history.slice(summaryIdx + 1);
		}
	}
	const recentUserTurns = effectiveHistory
		.filter(m => m.role === 'user' && !m.isContextSummary && m.attachments && m.attachments.length > 0)
		.slice(-3)
		.reverse();

	const seenAttachmentKeys = new Set(
		updatedAttachments.map(a => `${a.type}:${a.path || a.name}`),
	);
	const historyTextAttachments: ContextAttachment[] = [];
	for (const turn of recentUserTurns) {
		for (const att of turn.attachments ?? []) {
			if (att.type !== 'file' && att.type !== 'selection' && att.type !== 'external_file' && att.type !== 'canvas') {
				continue;
			}
			const ext = (att.path || att.name).split('.').pop()?.toLowerCase() ?? '';
			if (IMAGE_EXTENSIONS.has(ext) || att.content?.startsWith('data:image/')) {
				continue;
			}
			const key = `${att.type}:${att.path || att.name}`;
			if (!seenAttachmentKeys.has(key)) {
				seenAttachmentKeys.add(key);
				historyTextAttachments.push(att);
			}
		}
	}

	if (historyTextAttachments.length > 0) {
		const { attachmentContext: historyAttContext } = await ChatAttachmentHandler.buildAttachmentContext(
			plugin.app,
			historyTextAttachments,
			plugin,
			{ skipFolders: true },
		);
		if (historyAttContext.trim().length > 0) {
			const MAX_HISTORY_ATTACHMENT_CHARS = 30000;
			const trimmedHistoryAtt =
				historyAttContext.length > MAX_HISTORY_ATTACHMENT_CHARS
					? historyAttContext.slice(0, MAX_HISTORY_ATTACHMENT_CHARS) + '\n\n... (이전 턴 첨부 컨텍스트 일부 생략됨)'
					: historyAttContext.trim();
			attachmentContext = attachmentContext
				? `${attachmentContext}[이전 턴 첨부 컨텍스트]\n${trimmedHistoryAtt}\n\n`
				: `[이전 턴 첨부 컨텍스트]\n${trimmedHistoryAtt}\n\n`;
		}
	}

	let ragContext: string | undefined;
	let ragChunksForLog: RagChunkMeta[] | undefined;

	const failedSet = new Set(failedAttachments ?? []);
	const attachedVaultPaths = [
		...updatedAttachments.filter(a => !failedSet.has(a.name)),
		...historyTextAttachments,
	]
		.filter(a => {
			if (a.type !== 'file' && a.type !== 'active_note') return false;
			if (!a.path) return false;
			const ext = a.path.split('.').pop()?.toLowerCase() ?? '';
			return !IMAGE_EXTENSIONS.has(ext);
		})
		.map(a => a.path);

	if (isRagReady && plugin.indexer && (userText.trim().length > 0 || ragFilterFolders.length > 0)) {
		const result = await performRagSearch({
			userText,
			rag: ragSettings,
			connections: plugin.settings.connections,
			existingContext: undefined,
			assistantId,
			indexer: plugin.indexer,
			filterPaths: ragFilterFolders.length > 0 ? ragFilterFolders : undefined,
			excludePaths: attachedVaultPaths.length > 0 ? attachedVaultPaths : undefined,
			signal,
		});
		ragContext = result.ragContext;
		ragChunksForLog = result.ragChunksForLog;
	}

	// MCP 툴 수집
	const { mcp } = plugin.settings;
	const { mcpTools, toolServerMap } = collectMcpTools({
		agentEnabled: chatSettings.agentEnabled,
		clientToolsEnabled: mcp.clientToolsEnabled,
		mcpManager: plugin.mcpManager ?? null,
		agentExecutionMode: chatSettings.agentExecutionMode,
	});

	// 프롬프트 빌드
	const useLocal = isLocalProvider(providerConfig.type ?? 'custom');
	const isCli = isCliProvider(providerConfig.type ?? 'custom');
	const isCliAgent = isCli;
	const modelName = resolvedModelId.toLowerCase();
	const isReasoningModel = modelName.includes('reasoner') || modelName.includes('r1');
	const useTextTools = !isCliAgent && (useLocal || isReasoningModel);

	const webSearchTool = collectWebSearchTool({
		webSearch: plugin.settings.webSearch,
	});

	if (webSearchTool) {
		mcpTools.push(webSearchTool);
		toolServerMap[webSearchTool.name] = '__web_search__';
	}

	const activeFile = plugin.app.workspace.getActiveFile();
	const activeFilePath = activeFile?.path;
	const activeFileTitle = activeFile?.basename;

	let llmMessages: ChatMessage[] = buildMessages(history, userText, {
		chat: chatSettings,
		attachmentContext: attachmentContext || undefined,
		ragContext,
		sessionSummary: get(sessionSummary),
		summaryUpToMessageId: get(summaryUpToMessageId),
		activeFilePath,
		activeFileTitle
	});

	// 툴 사용 지침 주입 (CLI 에이전트는 자체 네이티브/설정 도구를 사용하므로 Lumina 텍스트 툴 프롬프트 주입 생략)
	if (!isCliAgent) {
		llmMessages = injectToolPrompts(llmMessages, mcpTools, useTextTools);
	}

	// 멀티모달 이미지 주입
	if (multimodalImages.length > 0) {
		if (isCliAgent) {
			// 로컬 파일 경로가 있는 이미지는 llmExecutor에서 CLI 에이전트에 직접 경로로 전달되어 분석됩니다.
			// 디스크 파일 경로가 없는 순수 인라인(Base64) 이미지인 경우에만 안내 알림 표시
			const hasUnlinkedInlineImage = updatedAttachments.some(
				(a) => !a.path && a.content?.startsWith('data:image/'),
			);
			if (hasUnlinkedInlineImage) {
				new Notice(t('uiMessages.cliImageNotSupported'));
			}
		} else {
			if (VISION_UNSUPPORTED_PROVIDERS.has(providerConfig.type)) {
				const providerLabel = PROVIDER_LABELS[providerConfig.type];
				throw new Error(t('settings.providerErrors.visionNotSupported', { provider: providerLabel }));
			}
			llmMessages = injectMultimodalImages(llmMessages, multimodalImages);
		}
	}

	return { llmMessages, ragChunksForLog, useTextTools, mcpTools, toolServerMap, attachments: updatedAttachments };
}
