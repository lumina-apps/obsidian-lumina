import type { SearchResult } from '../../shared/types/rag.types';
import type { LLMProviderConfig } from '../../shared/types/settings.types';
import { createProvider } from '../../core/llm-providers';
import { debugLogger } from '../../shared/debugLogger';
import { normalizeError } from '../../shared/utils/errorUtils';

export interface RerankOptions {
	/** 네이티브 rerank API 사용 시 이 점수 미만의 청크를 필터링 (선택) */
	minNativeScore?: number;
	/** 점수 필터링 시 최소 1개 결과는 보존할지 여부 (기본: true) */
	preserveAtLeastOne?: boolean;
}

/**
 * 리랭킹 모델에 전달할 청크 텍스트를 구성합니다.
 * 구조 컨텍스트(경로/헤딩)와 가장 일치도가 높았던 하위 청크(bestChildText)를 우선 포함합니다.
 */
function buildRerankSnippet(result: SearchResult): string {
	const header = result.chunk.contextPrefix
		? `${result.chunk.contextPrefix}\n`
		: result.chunk.headingPath && result.chunk.headingPath.length > 0
			? `[${result.chunk.path} > ${result.chunk.headingPath.join(' > ')}]\n`
			: '';
	const body = (result.bestChildText || result.chunk.text).slice(0, 600);
	return `${header}${body}`;
}

/**
 * 네이티브 Rerank API 또는 프롬프트 기반 Listwise Reranking 구현체.
 * RAG의 1차 검색 결과를 받아 쿼리 연관성 기준으로 재정렬한 후 지정된 개수만큼 반환합니다.
 * 오류 발생 시(Fallback) 원본 정렬 상태의 상위 N개를 그대로 반환합니다.
 */
export async function rerankChunks(
	query: string,
	chunks: SearchResult[],
	providerConfig: LLMProviderConfig,
	modelId: string,
	topK: number,
	signal?: AbortSignal,
	options?: RerankOptions,
): Promise<SearchResult[]> {
	if (chunks.length === 0) return chunks;

	try {
		const provider = createProvider(providerConfig);

		// 1. 네이티브 Rerank API 지원 여부 확인 및 시도
		if (provider.rerank) {
			const apiStart = Date.now();
			try {
				const documentTexts = chunks.map(c =>
					c.chunk.contextPrefix ? `${c.chunk.contextPrefix}\n${c.chunk.text}` : c.chunk.text,
				);
				const results = await provider.rerank(query, documentTexts, { model: modelId, topN: topK });
				debugLogger.logSystem('rag_rerank', `Native rerank completed (${results.length}/${chunks.length} chunks, ${Date.now() - apiStart}ms)`, {
					model: modelId,
					inputCount: chunks.length,
					outputCount: results.length,
					durationMs: Date.now() - apiStart,
				});

				const mapped = results
					.filter(r => r.index >= 0 && r.index < chunks.length)
					.map(r => ({
						...chunks[r.index],
						score: r.score,
					}));

				if (typeof options?.minNativeScore === 'number' && options.minNativeScore > 0 && mapped.length > 0) {
					const filtered = mapped.filter(item => item.score >= options.minNativeScore!);
					if (filtered.length > 0) {
						return filtered;
					}
					if (options.preserveAtLeastOne !== false) {
						return [mapped[0]];
					}
					return [];
				}

				return mapped;
			} catch (err) {
				if (err instanceof Error && err.name === 'AbortError') {
					throw err;
				}
				// API 호출 실패(예: 지원하지 않는 모델) 시 프롬프트 기반으로 우회
				debugLogger.logError('rag_rerank', normalizeError(err, `Native rerank API failed, falling back to prompt-based: ${err}`));
			}
		}

		// 2. 프롬프트 기반 Listwise Reranking (Fallback)
		const prompt = `You are an expert relevance ranker.
Given the following user query and a list of document chunks, rank the chunks by their relevance to the query.

CRITICAL RULES:
1. Return ONLY a comma-separated list of chunk indices (e.g., 2,0,1,3) ordered from most relevant to least relevant.
2. DO NOT include any other text, explanation, or markdown formatting.

User Query:
${query}

Document Chunks:
${chunks.map((c, i) => `[${i}] ${buildRerankSnippet(c)}...`).join('\n\n')}
`;

		const reqStart = Date.now();
		const requestId = debugLogger.logRequest({
			provider: providerConfig.type,
			model: modelId,
			temperature: 0.1,
			maxTokens: 150,
			stream: false,
			systemPrompt: `[RAG Listwise Rerank — ${chunks.length} chunks]`,
			messages: [{ role: 'user', content: prompt }],
		});

		let response: import('../../shared/types/llm.types').ChatResponse;
		try {
			response = await provider.chat(
				[{ role: 'user', content: prompt }],
				{
					model: modelId,
					temperature: 0.1,
					maxOutputTokens: 150,
					signal
				}
			);
			debugLogger.logResponse(requestId, {
				model: modelId,
				content: response.content.trim(),
				durationMs: Date.now() - reqStart,
				usage: response.usage,
				...(response.finishReason ? { stopReason: response.finishReason } : {}),
			});
		} catch (chatErr) {
			const isAborted = chatErr instanceof Error && chatErr.name === 'AbortError';
			debugLogger.logResponse(requestId, {
				model: modelId,
				content: `❌ [Error] ${chatErr instanceof Error ? chatErr.message : String(chatErr)}`,
				durationMs: Date.now() - reqStart,
				stopReason: isAborted ? 'aborted' : 'error',
			});
			throw chatErr;
		}

		const resultText = response.content.trim();
		let orderedIndices: number[] = [];

		const lines = resultText.split('\n').map(l => l.trim()).filter(Boolean);
		if (lines.length > 1) {
			for (const line of lines) {
				const m = line.match(/^(?:\d+[.)]|[-*])\s*(?:chunk\s*)?\[?(\d+)\]?/i) || line.match(/^(?:chunk\s*)?\[?(\d+)\]?/i);
				if (m && m[1]) {
					const idx = parseInt(m[1], 10);
					if (!isNaN(idx) && idx >= 0 && idx < chunks.length) {
						orderedIndices.push(idx);
					}
				}
			}
		}

		if (orderedIndices.length === 0) {
			const matches = resultText.match(/\d+/g);
			orderedIndices = matches ? matches.map(s => parseInt(s, 10)).filter(n => !isNaN(n) && n >= 0 && n < chunks.length) : [];
		}

		const rankedChunks: SearchResult[] = [];
		const added = new Set<number>();

		for (const idx of orderedIndices) {
			if (!added.has(idx)) {
				rankedChunks.push(chunks[idx]);
				added.add(idx);
			}
		}

		// 누락된 청크는 뒤에 덧붙임
		for (let i = 0; i < chunks.length; i++) {
			if (!added.has(i)) {
				rankedChunks.push(chunks[i]);
				added.add(i);
			}
		}

		return rankedChunks.slice(0, topK);
	} catch (e) {
		if (e instanceof Error && e.name === 'AbortError') {
			throw e;
		}
		debugLogger.logError('rag_rerank', normalizeError(e, `Reranking failed: ${e}`));
		// Fallback: 기존 1차 검색 순위대로 잘라서 반환
		return chunks.slice(0, topK);
	}
}
