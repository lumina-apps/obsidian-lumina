import type { App } from 'obsidian';
import { get } from 'svelte/store';
import { t } from '../../../shared/locales/helpers';
import type { ContextAttachment, UIChatMessage } from '../../../shared/types/chat.types';
import type LuminaPlugin from '../../../main';
import type { LLMProviderConfig } from '../../../shared/types/settings.types';
import type { ChatMessage, ToolDefinition } from '../../../shared/types/llm.types';
import type { RagChunkMeta } from '../../../shared/types/debug.types';
import { VISION_UNSUPPORTED_PROVIDERS, PROVIDER_LABELS } from '../../../shared/types/settings.types';
import { isLocalProvider } from '../../../core/llm-providers/index';
import { indexingState } from '../../../core/store/ragStore';
import { sessionSummary, summaryUpToMessageId } from '../../../core/store/chatStore';
import { buildMessages } from '../promptBuilder';
import { ChatAttachmentHandler } from './ChatAttachmentHandler';
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

	// 첨부파일 컨텍스트 빌드
	const { attachmentContext, multimodalImages } =
		await ChatAttachmentHandler.buildAttachmentContext(plugin.app, updatedAttachments, plugin, { skipFolders: shouldSearchRag });

	let ragContext: string | undefined = attachmentContext || undefined;
	let ragChunksForLog: RagChunkMeta[] | undefined;

	if (shouldSearchRag && plugin.indexer && get(indexingState).status === 'ready') {
		const filterPaths = updatedAttachments.filter(a => a.type === 'folder').map(a => a.path);

		const result = await performRagSearch({
			userText,
			rag: ragSettings,
			connections: plugin.settings.connections,
			existingContext: ragContext,
			assistantId,
			indexer: plugin.indexer,
			activeFilePath: plugin.app.workspace.getActiveFile()?.path ?? null,
			filterPaths: filterPaths.length > 0 ? filterPaths : undefined,
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
	const modelName = resolvedModelId.toLowerCase();
	const isReasoningModel = modelName.includes('reasoner') || modelName.includes('r1');
	const useTextTools = useLocal || isReasoningModel;

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
		ragContext,
		sessionSummary: get(sessionSummary),
		summaryUpToMessageId: get(summaryUpToMessageId),
		activeFilePath,
		activeFileTitle
	});

	// 툴 사용 지침 주입
	llmMessages = injectToolPrompts(llmMessages, mcpTools, useTextTools);

	// 멀티모달 이미지 주입
	if (multimodalImages.length > 0) {
		if (VISION_UNSUPPORTED_PROVIDERS.has(providerConfig.type)) {
			const providerLabel = PROVIDER_LABELS[providerConfig.type];
			throw new Error(t('settings.providerErrors.visionNotSupported', { provider: providerLabel }));
		}
		llmMessages = injectMultimodalImages(llmMessages, multimodalImages);
	}

	return { llmMessages, ragChunksForLog, useTextTools, mcpTools, toolServerMap };
}
