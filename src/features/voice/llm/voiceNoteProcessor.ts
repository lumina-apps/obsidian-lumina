/**
 * voiceNoteProcessor.ts
 *
 * 사용자가 Lumina에 이미 연결·검증한 LLM 프로바이더(createProvider)만을 사용해
 * 전사 텍스트를 교정·구조화하고, 기존 볼트 노트 기반 자동 위키링크([[...]])를 적용합니다.
 */

import { App, TFile } from 'obsidian';
import { get } from 'svelte/store';
import type LuminaPlugin from '../../../main';
import { createProvider } from '../../../core/llm-providers';
import { applyAutoLink, calculateAutoLinks } from '../../../core/mcp/server/handlers/utils/autoLinker';
import { sessionModelId, sessionProviderId } from '../../../core/store/chatStore';
import { isCliProvider, type LLMProviderConfig } from '../../../shared/types/settings.types';
import type {
	TranscriptSegment,
	VoiceNotePreferences,
	VoiceTemplateId,
} from '../../../shared/types/voice.types';
import { getVoiceEligibleLlmProviders } from '../voicePreferences';
import { buildVoiceFormattingMessages, cleanFormattedVoiceOutput } from './voicePrompts';

export { getVoiceEligibleLlmProviders };

/**
 * 노트 정리 속도를 저하시키는 추론(Reasoning) 전용 모델인지 판별합니다.
 */
export function isSlowReasoningModel(modelId: string): boolean {
	const lower = modelId.toLowerCase();
	return (
		/(?:^|[_\W/-])(r1|o1|o3|o4)(?:$|[_\W/-])/.test(lower) ||
		lower.includes('qwq') ||
		lower.includes('reasoning') ||
		lower.includes('reasoner') ||
		lower.includes('thinking')
	);
}

/**
 * 템플릿 성격과 사용자 설정에 따라 최적의 연결 LLM 프로바이더와 모델을 결정합니다.
 * - 사용자 지정 모델이 있으면 항상 1순위
 * - 'verbatim'(그대로 받아쓰기): 속도가 최우선이므로 Task 모델 -> Quick Action 모델 -> 주력 채팅 모델 순
 * - 'clean'/'meeting'(정리/회의록): 품질이 최우선이므로 현재 주력 채팅 모델(단, 느린 추론 모델·CLI는 자동 우회) -> Task 모델 -> Quick Action 모델 순
 */
export function resolveVoiceLlmProviderAndModel(
	plugin: LuminaPlugin,
	prefs: Required<VoiceNotePreferences>,
	templateId: VoiceTemplateId = 'clean',
): { providerConfig: LLMProviderConfig; modelId: string } | null {
	const eligible = getVoiceEligibleLlmProviders(plugin.settings.connections.providers);
	if (eligible.length === 0) return null;

	const findExact = (
		providerId?: string,
		modelId?: string,
		opts?: { excludeCli?: boolean; excludeReasoning?: boolean },
	) => {
		if (!providerId || !modelId) return null;
		const prov = eligible.find((p) => p.id === providerId);
		if (!prov) return null;
		if (opts?.excludeCli && isCliProvider(prov.type)) return null;
		if (opts?.excludeReasoning && isSlowReasoningModel(modelId)) return null;
		return { providerConfig: prov, modelId };
	};

	// 1. 사용자가 Voice-to-Note 설정에서 명시적으로 지정한 모델은 항상 최우선
	const fromPrefs = findExact(prefs.llmProviderId, prefs.llmModelId);
	if (fromPrefs) return fromPrefs;

	const { connections } = plugin.settings;
	const activeSessionId = get(sessionProviderId) ?? undefined;
	const activeModelId = get(sessionModelId) ?? undefined;

	// 2. 그대로 받아쓰기(verbatim): 단순 추임새·오탈자 교정이므로 빠른 Task / QuickAction 모델 우선
	if (templateId === 'verbatim') {
		const fastTask = findExact(connections.taskProviderId, connections.taskModelId, {
			excludeCli: true,
			excludeReasoning: true,
		});
		if (fastTask) return fastTask;

		const fastQa = findExact(connections.quickActionProviderId, connections.quickActionModelId, {
			excludeCli: true,
			excludeReasoning: true,
		});
		if (fastQa) return fastQa;
	}

	// 3. 깔끔 정리 / 회의록 (또는 verbatim 폴백): 주력 채팅 모델 우선 (단, 느린 추론 모델이나 CLI는 우회)
	const fastSession = findExact(activeSessionId, activeModelId, {
		excludeCli: true,
		excludeReasoning: true,
	});
	if (fastSession) return fastSession;

	const fromTask = findExact(connections.taskProviderId, connections.taskModelId, {
		excludeCli: true,
		excludeReasoning: true,
	});
	if (fromTask) return fromTask;

	const fromQa = findExact(connections.quickActionProviderId, connections.quickActionModelId, {
		excludeCli: true,
		excludeReasoning: true,
	});
	if (fromQa) return fromQa;

	// 4. 비-CLI · 비-추론 일반 모델 탐색
	for (const prov of eligible) {
		if (isCliProvider(prov.type)) continue;
		const fastModel = prov.availableModels.find((m) => !isSlowReasoningModel(m));
		if (fastModel) {
			return { providerConfig: prov, modelId: fastModel };
		}
	}

	// 5. 최후 폴백 (추론 모델이나 CLI밖에 없는 경우)
	const anySession = findExact(activeSessionId, activeModelId);
	if (anySession) return anySession;

	const nonCli = eligible.find((p) => !isCliProvider(p.type));
	const chosen = nonCli ?? eligible[0];
	return { providerConfig: chosen, modelId: chosen.availableModels[0] };
}

/**
 * 볼트 내 마크다운 노트 제목 목록을 수집합니다 (고유명사/문맥 보정 힌트용).
 */
export function collectVaultNoteTitles(
	app: App,
	excludeFile: TFile | null,
	limit: number = 40,
): string[] {
	const files = app.vault.getMarkdownFiles();
	const titles: string[] = [];
	for (const f of files) {
		if (excludeFile && f.path === excludeFile.path) continue;
		if (f.basename.trim()) {
			titles.push(f.basename.trim());
		}
		if (titles.length >= limit) break;
	}
	return titles;
}

/**
 * 대상 파일이 없는 새 노트 생성 시에도 볼트 전체 노트 제목·별칭으로 자동 위키링크를 적용합니다.
 */
function applyVaultAutoLinksForNewNote(app: App, content: string): string {
	const allFiles = app.vault.getMarkdownFiles();
	const termsMap = new Map<string, string>();

	for (const f of allFiles) {
		const normalized = f.basename.normalize('NFC');
		const lower = normalized.toLowerCase();
		if (!termsMap.has(lower)) {
			termsMap.set(lower, normalized);
		}
		const cache = app.metadataCache?.getFileCache?.(f);
		const rawAliases = cache?.frontmatter?.aliases;
		if (rawAliases) {
			const aliases = Array.isArray(rawAliases) ? rawAliases : [rawAliases];
			for (const alias of aliases) {
				if (typeof alias === 'string' && alias.trim()) {
					const normAlias = alias.trim().normalize('NFC');
					const aliasLower = normAlias.toLowerCase();
					if (!termsMap.has(aliasLower)) {
						termsMap.set(aliasLower, normalized);
					}
				}
			}
		}
	}

	const terms = Array.from(termsMap.entries())
		.map(([lower, path]) => ({ originalTerm: lower, path }))
		.sort((a, b) => b.originalTerm.length - a.originalTerm.length);

	return applyAutoLink(content, terms).newContent;
}

export interface ProcessTranscriptParams {
	plugin: LuminaPlugin;
	prefs: Required<VoiceNotePreferences>;
	templateId: VoiceTemplateId;
	rawTranscript: string;
	segments: TranscriptSegment[];
	targetFile: TFile | null;
	userMemoDiff?: string;
	signal?: AbortSignal;
	onStage?: (step: 2 | 3) => void;
}

export interface ProcessTranscriptOutput {
	/** LLM으로 정리되고(가능한 경우) 위키링크가 적용된 마크다운 본문 */
	formattedBody: string;
	/** LLM 후처리 수행 여부 (false면 원문 폴백) */
	usedLlm: boolean;
}

/**
 * 전사 결과를 사용자 연결 LLM으로 구조화하고 볼트 위키링크를 자동 연결합니다.
 */
export async function processTranscriptToNote(
	params: ProcessTranscriptParams,
): Promise<ProcessTranscriptOutput> {
	const { plugin, prefs, templateId, rawTranscript, segments, targetFile, userMemoDiff, signal } = params;

	const resolved = resolveVoiceLlmProviderAndModel(plugin, prefs, templateId);
	if (!resolved) {
		let fallback = rawTranscript.trim();
		if (prefs.autoWikiLink && fallback) {
			fallback = targetFile
				? calculateAutoLinks(plugin.app, targetFile, fallback).newContent
				: applyVaultAutoLinksForNewNote(plugin.app, fallback);
		}
		return { formattedBody: fallback, usedLlm: false };
	}

	params.onStage?.(2);
	const vaultNoteTitles = collectVaultNoteTitles(plugin.app, targetFile);
	const messages = buildVoiceFormattingMessages({
		templateId,
		rawTranscript,
		segments,
		userMemoDiff,
		activeNoteTitle: targetFile?.basename,
		customVocabulary: prefs.customVocabulary,
		vaultNoteTitles,
		responseLanguage: plugin.settings.chat.responseLanguage,
	});

	params.onStage?.(3);
	const provider = createProvider(resolved.providerConfig);
	const response = await provider.chat(messages, {
		model: resolved.modelId,
		temperature: 0.3,
		maxOutputTokens: Math.max(2000, plugin.settings.chat.maxOutputTokens || 4000),
		signal,
		ttftTimeoutMs: plugin.settings.chat.ttftTimeoutMs,
		interTokenTimeoutMs: plugin.settings.chat.interTokenTimeoutMs,
	});

	let formattedBody = cleanFormattedVoiceOutput(response.content);
	if (!formattedBody) {
		formattedBody = rawTranscript.trim();
	}

	if (prefs.autoWikiLink && formattedBody) {
		formattedBody = targetFile
			? calculateAutoLinks(plugin.app, targetFile, formattedBody).newContent
			: applyVaultAutoLinksForNewNote(plugin.app, formattedBody);
	}

	return { formattedBody, usedLlm: true };
}
