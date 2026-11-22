/**
 * batchRecipes.ts
 *
 * Lumina Batch Studio의 플러그형 레시피 실행 엔진.
 * - frontmatter: 태그(최대 3개) 및 한 줄 요약(description) 생성
 * - autolink: 볼트 내 노트 제목·별칭 기반 [[위키링크]] 일괄 연결
 * - summary-callout: 노트 본문 최상단 > [!summary] 콜아웃 생성
 * - custom-prompt: {{title}}, {{content}}, {{frontmatter}}, {{folder}} 기반 자유 프롬프트
 */

import { App, TFile } from 'obsidian';
import type LuminaPlugin from '../../../main';
import { createProvider } from '../../../core/llm-providers';
import { calculateAutoLinks } from '../../../core/mcp/server/handlers/utils/autoLinker';
import { debugLogger } from '../../../shared/debugLogger';
import { t } from '../../../shared/locales/helpers';
import type {
	BatchProposedChange,
	BatchRecipeId,
	BatchRecipeOptions,
} from '../../../shared/types/batch.types';
import type { ChatResponse } from '../../../shared/types/llm.types';
import { isCliProvider, type LLMProviderConfig } from '../../../shared/types/settings.types';
import {
	normalizeFrontmatterTags,
	sanitizeGeneratedFrontmatterData,
} from '../../../shared/utils/frontmatterSanitizer';
import { stripThinkTags } from '../../../shared/utils/llmTextSanitizer';
import { isEmbeddingModel } from '../../../shared/utils/modelUtils';

/** 배치 LLM 호출 시 출력 잘림을 방지하기 위한 기본 최대 출력 토큰 */
const BATCH_DEFAULT_MAX_OUTPUT_TOKENS = 1200;

/** 레시피 실행 결과 */
export interface RecipeExecutionResult {
	/** 생성된 변경 제안 (변경할 내용이 없으면 null) */
	proposed: BatchProposedChange | null;
	/** 변경 없음으로 건너뛴 사유 */
	skipReason?: string;
	/** 소모된 총 토큰 수 */
	tokensUsed: number;
}

/**
 * 배치 작업에서 사용 가능한 비-CLI 검증 완료 LLM 프로바이더 목록을 반환합니다.
 */
export function getBatchEligibleProviders(
	providers: readonly LLMProviderConfig[],
): LLMProviderConfig[] {
	return providers
		.filter((p) => !isCliProvider(p.type) && p.isVerified && p.availableModels.length > 0)
		.map((p) => {
			const chatModels = p.availableModels.filter((m) => !isEmbeddingModel(p.type, m));
			return {
				...p,
				availableModels: chatModels.length > 0 ? chatModels : p.availableModels,
			};
		});
}

/**
 * 레시피 옵션 또는 플러그인 Task/기본 설정에서 실행할 프로바이더와 모델 ID를 결정합니다.
 */
export function resolveBatchProviderAndModel(
	plugin: LuminaPlugin,
	options: BatchRecipeOptions,
): { providerConfig: LLMProviderConfig; modelId: string } {
	const connections = plugin.settings.connections;
	const eligible = getBatchEligibleProviders(connections.providers);
	if (eligible.length === 0) {
		throw new Error(t('batchStudio.options.noModelConfigured'));
	}

	// 1. 사용자가 배치 스튜디오 UI에서 명시적으로 고른 모델 우선
	if (options.providerId && options.modelId) {
		const explicit = eligible.find((p) => p.id === options.providerId);
		if (explicit) {
			return { providerConfig: explicit, modelId: options.modelId };
		}
	}

	// 2. 설정의 Task 전용 모델 우선
	if (connections.taskProviderId && connections.taskModelId) {
		const taskProv = eligible.find((p) => p.id === connections.taskProviderId);
		if (taskProv) {
			return { providerConfig: taskProv, modelId: connections.taskModelId };
		}
	}

	// 3. 퀵 액션 모델 폴백
	if (connections.quickActionProviderId && connections.quickActionModelId) {
		const qaProv = eligible.find((p) => p.id === connections.quickActionProviderId);
		if (qaProv) {
			return { providerConfig: qaProv, modelId: connections.quickActionModelId };
		}
	}

	// 4. 첫 번째 검증된 모델 폴백
	const first = eligible[0];
	return { providerConfig: first, modelId: first.availableModels[0] };
}

/** 마크다운 원문에서 선행 YAML 프론트매터 블록과 본문을 분리합니다. */
export function splitFrontmatterAndBody(rawContent: string): {
	frontmatterBlock: string;
	body: string;
} {
	const match = rawContent.match(/^(---\r?\n(?:[\s\S]*?\r?\n)?---\r?\n?)/);
	if (!match) {
		return { frontmatterBlock: '', body: rawContent };
	}
	const frontmatterBlock = match[1];
	const body = rawContent.slice(frontmatterBlock.length);
	return { frontmatterBlock, body };
}

/** Rate limit(429) 오류인지 판별합니다. */
export function isRateLimitError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err);
	const status =
		typeof err === 'object' && err !== null && 'status' in err ? Number(err.status) : null;
	return status === 429 || msg.includes('HTTP 429') || /\b429\b/.test(msg) || /rate\s*limit/i.test(msg);
}

/** 공통 LLM 호출 및 디버그 로깅 헬퍼 */
async function callBatchLlm(
	plugin: LuminaPlugin,
	options: BatchRecipeOptions,
	filePath: string,
	recipeLabel: string,
	prompt: string,
	signal?: AbortSignal,
	maxOutputTokens: number = BATCH_DEFAULT_MAX_OUTPUT_TOKENS,
): Promise<{ text: string; tokensUsed: number }> {
	const { providerConfig, modelId } = resolveBatchProviderAndModel(plugin, options);
	const reqStart = Date.now();
	const requestId = debugLogger.logRequest({
		provider: providerConfig.type,
		model: modelId,
		temperature: 0.2,
		maxTokens: maxOutputTokens,
		stream: false,
		systemPrompt: `[Batch ${recipeLabel} — ${filePath}]`,
		messages: [{ role: 'user', content: prompt }],
	});

	const provider = createProvider(providerConfig);
	let response: ChatResponse;
	try {
		response = await provider.chat([{ role: 'user', content: prompt }], {
			model: modelId,
			temperature: 0.2,
			maxOutputTokens,
			signal,
			ttftTimeoutMs: 20000,
			interTokenTimeoutMs: 12000,
		});
		debugLogger.logResponse(requestId, {
			model: modelId,
			content: response.content,
			durationMs: Date.now() - reqStart,
			usage: response.usage,
			...(response.finishReason ? { stopReason: response.finishReason } : {}),
		});
	} catch (err) {
		debugLogger.logResponse(requestId, {
			model: modelId,
			content: `❌ [Error] ${err instanceof Error ? err.message : String(err)}`,
			durationMs: Date.now() - reqStart,
			stopReason: 'error',
		});
		throw err;
	}

	const cleaned = stripThinkTags(
		response.content
			.replace(/&lt;think&gt;/gi, '<think>')
			.replace(/&lt;\/think&gt;/gi, '</think>'),
	).trim();

	return {
		text: cleaned,
		tokensUsed: response.usage?.totalTokens ?? 0,
	};
}

/** 두 태그 배열이 내용상 동일한지 비교 */
function areTagsEqual(a: readonly string[], b: readonly string[]): boolean {
	if (a.length !== b.length) return false;
	return a.every((val, idx) => val === b[idx]);
}

/** 태그 병합 (대소문자 무시 중복 제거, 기존 태그 순서 보존) */
function mergeTagLists(existing: readonly string[], incoming: readonly string[]): string[] {
	const result: string[] = [];
	const seen = new Set<string>();
	for (const tag of [...existing, ...incoming]) {
		const cleaned = tag.trim().replace(/^#+/, '').trim();
		if (!cleaned) continue;
		const lower = cleaned.toLowerCase();
		if (seen.has(lower)) continue;
		seen.add(lower);
		result.push(cleaned);
	}
	return result;
}

/** 마크다운 코드펜스를 벗기고 JSON 객체를 추출 */
function extractJsonObject(text: string): unknown {
	const stripped = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
	const match = stripped.match(/\{[\s\S]*\}/);
	if (!match) {
		throw new Error('LLM did not return a valid JSON object.');
	}
	return JSON.parse(match[0]) as unknown;
}

/** 레시피 1: 프론트매터(tags, description) 생성 */
async function runFrontmatterRecipe(
	app: App,
	plugin: LuminaPlugin,
	file: TFile,
	options: BatchRecipeOptions,
	minContentLength: number,
	signal?: AbortSignal,
): Promise<RecipeExecutionResult> {
	if (!options.generateTags && !options.generateDescription) {
		return { proposed: null, skipReason: 'no-fields-selected', tokensUsed: 0 };
	}

	const rawContent = await app.vault.read(file);
	const { body } = splitFrontmatterAndBody(rawContent);
	const trimmedBody = body.trim();
	if (trimmedBody.length < Math.max(10, minContentLength)) {
		return { proposed: null, skipReason: 'too-short', tokensUsed: 0 };
	}

	const fm: Record<string, unknown> | undefined =
		app.metadataCache?.getFileCache(file)?.frontmatter;
	const beforeTags = normalizeFrontmatterTags(fm?.tags);
	const beforeDescription =
		typeof fm?.description === 'string' ? fm.description.trim() : '';

	if (options.fmMergeMode === 'empty-only') {
		const tagsDone = !options.generateTags || beforeTags.length > 0;
		const descDone = !options.generateDescription || beforeDescription.length > 0;
		if (tagsDone && descDone) {
			return { proposed: null, skipReason: 'already-filled', tokensUsed: 0 };
		}
	}

	const prompt = `Analyze the following markdown document and return 1 to 3 relevant topic tags and a 1-sentence summary (description) in JSON format.
CRITICAL RULES:
1. Write the tags and description in the EXACT SAME LANGUAGE as the document content (e.g., Korean for Korean notes, English for English notes).
2. Tags MUST be specific, meaningful keywords/topics derived directly from the document content (without a leading "#").
3. NEVER copy placeholder strings such as "tag1", "tag2", "tag", "example", or template descriptions verbatim.
4. Output ONLY a valid JSON object matching this schema with no additional text or markdown fences:
{"tags": ["<specific topic from note>"], "description": "<1-sentence summary in the note's language>"}

Document Title: ${file.basename}
Document Content:
${trimmedBody.substring(0, 3000)}`;

	const { text, tokensUsed } = await callBatchLlm(
		plugin,
		options,
		file.path,
		'Frontmatter',
		prompt,
		signal,
	);

	const parsed = extractJsonObject(text);
	const sanitized = sanitizeGeneratedFrontmatterData(parsed);
	if (!sanitized) {
		return { proposed: null, skipReason: 'empty-generation', tokensUsed };
	}

	let afterTags = [...beforeTags];
	let afterDescription = beforeDescription;

	if (options.generateTags && sanitized.tags.length > 0) {
		if (options.fmMergeMode === 'empty-only') {
			if (beforeTags.length === 0) {
				afterTags = sanitized.tags;
			}
		} else if (options.fmMergeMode === 'merge') {
			afterTags = mergeTagLists(beforeTags, sanitized.tags);
		} else {
			afterTags = sanitized.tags;
		}
	}

	if (options.generateDescription && sanitized.description) {
		if (options.fmMergeMode === 'overwrite' || !beforeDescription) {
			afterDescription = sanitized.description;
		}
	}

	const tagsChanged = !areTagsEqual(beforeTags, afterTags);
	const descChanged = beforeDescription !== afterDescription;

	if (!tagsChanged && !descChanged) {
		return { proposed: null, skipReason: 'no-changes', tokensUsed };
	}

	const summaryParts: string[] = [];
	if (tagsChanged) {
		const diffCount = afterTags.length - beforeTags.length;
		summaryParts.push(diffCount > 0 ? `+${diffCount} tags` : `${afterTags.length} tags`);
	}
	if (descChanged) {
		summaryParts.push('description');
	}

	return {
		proposed: {
			kind: 'frontmatter',
			beforeTags,
			afterTags,
			beforeDescription,
			afterDescription,
			summaryText: summaryParts.join(' · '),
		},
		tokensUsed,
	};
}

/** 레시피 2: 볼트 내 노트 제목·별칭 기반 자동 위키링크([[...]]) 연결 */
async function runAutoLinkRecipe(app: App, file: TFile): Promise<RecipeExecutionResult> {
	const rawContent = await app.vault.read(file);
	const { newContent, linksAdded } = calculateAutoLinks(app, file, rawContent);

	if (linksAdded === 0 || newContent === rawContent) {
		return { proposed: null, skipReason: 'no-links', tokensUsed: 0 };
	}

	return {
		proposed: {
			kind: 'content',
			beforeContent: rawContent,
			afterContent: newContent,
			summaryText: `+${linksAdded} link${linksAdded > 1 ? 's' : ''}`,
		},
		tokensUsed: 0,
	};
}

/** 레시피 3: 본문 최상단 요약 콜아웃(> [!summary]) 생성 */
async function runSummaryCalloutRecipe(
	app: App,
	plugin: LuminaPlugin,
	file: TFile,
	options: BatchRecipeOptions,
	skipIfAlreadyHasTarget: boolean,
	minContentLength: number,
	signal?: AbortSignal,
): Promise<RecipeExecutionResult> {
	const rawContent = await app.vault.read(file);
	const { frontmatterBlock, body } = splitFrontmatterAndBody(rawContent);
	const trimmedBody = body.trim();

	if (trimmedBody.length < Math.max(10, minContentLength)) {
		return { proposed: null, skipReason: 'too-short', tokensUsed: 0 };
	}

	if (skipIfAlreadyHasTarget && /^>\s*\[!summary\]/im.test(trimmedBody)) {
		return { proposed: null, skipReason: 'already-has-callout', tokensUsed: 0 };
	}

	const prompt = `Summarize the following markdown note in 2 to 3 concise sentences.
CRITICAL RULES:
1. Write the summary in the EXACT SAME LANGUAGE as the note content.
2. Output ONLY plain summary sentences (no markdown callout syntax, no heading, no preamble).

Document Title: ${file.basename}
Document Content:
${trimmedBody.substring(0, 4000)}`;

	const { text, tokensUsed } = await callBatchLlm(
		plugin,
		options,
		file.path,
		'Summary Callout',
		prompt,
		signal,
	);

	if (!text) {
		return { proposed: null, skipReason: 'empty-generation', tokensUsed };
	}

	const calloutTitle = options.calloutTitle.trim() || 'Summary';
	const quotedBody = text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line) => `> ${line}`)
		.join('\n');

	const calloutBlock = `> [!summary] ${calloutTitle}\n${quotedBody}`;
	const prefix = frontmatterBlock
		? frontmatterBlock.endsWith('\n')
			? frontmatterBlock
			: `${frontmatterBlock}\n`
		: '';
	const rest = body.replace(/^\s+/, '');
	const afterContent = rest ? `${prefix}${calloutBlock}\n\n${rest}` : `${prefix}${calloutBlock}\n`;

	return {
		proposed: {
			kind: 'content',
			beforeContent: rawContent,
			afterContent,
			summaryText: '+summary',
		},
		tokensUsed,
	};
}

/** 레시피 4: 사용자 지정 템플릿 변수 기반 커스텀 프롬프트 */
async function runCustomPromptRecipe(
	app: App,
	plugin: LuminaPlugin,
	file: TFile,
	options: BatchRecipeOptions,
	minContentLength: number,
	signal?: AbortSignal,
): Promise<RecipeExecutionResult> {
	const template = options.customPrompt.trim();
	if (!template) {
		throw new Error('Custom prompt is empty.');
	}

	const rawContent = await app.vault.read(file);
	const { frontmatterBlock, body } = splitFrontmatterAndBody(rawContent);
	const trimmedBody = body.trim();
	if (trimmedBody.length < Math.max(10, minContentLength)) {
		return { proposed: null, skipReason: 'too-short', tokensUsed: 0 };
	}

	const lastSlash = file.path.lastIndexOf('/');
	const folderName = lastSlash > 0 ? file.path.slice(0, lastSlash) : '/';
	const contentExcerpt = trimmedBody.substring(0, 6000);
	const fmText = frontmatterBlock.trim() || '(none)';

	const hasExplicitContentVar = /\{\{\s*content\s*\}\}/i.test(template);
	let renderedPrompt = template
		.replace(/\{\{\s*title\s*\}\}/gi, file.basename)
		.replace(/\{\{\s*folder\s*\}\}/gi, folderName)
		.replace(/\{\{\s*frontmatter\s*\}\}/gi, fmText)
		.replace(/\{\{\s*content\s*\}\}/gi, contentExcerpt);

	if (!hasExplicitContentVar) {
		renderedPrompt = `${renderedPrompt}\n\nNote Title: ${file.basename}\nDocument Content:\n${contentExcerpt}`;
	}

	const { text, tokensUsed } = await callBatchLlm(
		plugin,
		options,
		file.path,
		'Custom Prompt',
		renderedPrompt,
		signal,
		1800,
	);

	if (!text) {
		return { proposed: null, skipReason: 'empty-generation', tokensUsed };
	}

	if (options.customOutputMode === 'frontmatter-key') {
		const key = options.customFrontmatterKey.trim() || 'ai_summary';
		const fm: Record<string, unknown> | undefined =
			app.metadataCache?.getFileCache(file)?.frontmatter;
		const prevRaw = fm?.[key];
		const beforeCustomFmVal =
			prevRaw === undefined || prevRaw === null
				? ''
				: Array.isArray(prevRaw)
					? prevRaw.join(', ')
					: String(prevRaw);

		if (beforeCustomFmVal === text) {
			return { proposed: null, skipReason: 'no-changes', tokensUsed };
		}

		return {
			proposed: {
				kind: 'frontmatter',
				customFmKey: key,
				beforeCustomFmVal,
				afterCustomFmVal: text,
				summaryText: key,
			},
			tokensUsed,
		};
	}

	let afterContent = rawContent;
	const prefix = frontmatterBlock
		? frontmatterBlock.endsWith('\n')
			? frontmatterBlock
			: `${frontmatterBlock}\n`
		: '';

	if (options.customOutputMode === 'prepend') {
		const rest = body.replace(/^\s+/, '');
		afterContent = rest ? `${prefix}${text}\n\n${rest}` : `${prefix}${text}\n`;
	} else if (options.customOutputMode === 'append') {
		const trimmedRaw = rawContent.replace(/\s+$/, '');
		afterContent = `${trimmedRaw}\n\n${text}\n`;
	} else {
		// replace
		afterContent = `${prefix}${text}\n`;
	}

	if (afterContent === rawContent) {
		return { proposed: null, skipReason: 'no-changes', tokensUsed };
	}

	return {
		proposed: {
			kind: 'content',
			beforeContent: rawContent,
			afterContent,
			summaryText: options.customOutputMode,
		},
		tokensUsed,
	};
}

/**
 * 단일 파일에 대해 선택된 배치 레시피를 실행하고 변경 제안을 계산합니다.
 */
export async function executeRecipeForFile(
	app: App,
	plugin: LuminaPlugin,
	file: TFile,
	recipeId: BatchRecipeId,
	options: BatchRecipeOptions,
	config?: { skipIfAlreadyHasTarget?: boolean; minContentLength?: number },
	signal?: AbortSignal,
): Promise<RecipeExecutionResult> {
	const skipIfAlready = config?.skipIfAlreadyHasTarget ?? true;
	const minChars = config?.minContentLength ?? 50;

	switch (recipeId) {
		case 'frontmatter':
			return runFrontmatterRecipe(app, plugin, file, options, minChars, signal);
		case 'autolink':
			return runAutoLinkRecipe(app, file);
		case 'summary-callout':
			return runSummaryCalloutRecipe(app, plugin, file, options, skipIfAlready, minChars, signal);
		case 'custom-prompt':
			return runCustomPromptRecipe(app, plugin, file, options, minChars, signal);
	}
}
