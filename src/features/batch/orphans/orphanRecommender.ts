/**
 * 고아노트 연결 추천 엔진.
 * - 1순위: `plugin.indexer.indexedChildChunks` 벡터의 Mean Pooling + 코사인 유사도 (features/rag 미참조)
 * - 2순위: RAG 미사용·미인덱싱 시 제목 토큰 + 공통 태그 + 같은 폴더 기반 메타데이터 폴백
 */

import { App, TFile, normalizePath } from 'obsidian';
import type LuminaPlugin from '../../../main';
import type { OrphanLinkSuggestion } from '../../../shared/types/orphan.types';
import type { ChildChunk, ParentChunk } from '../../../shared/types/rag.types';
import { isExcluded } from '../../../shared/utils/exclusions';
import {
	buildVaultLinkCounts,
	collectNormalizedTagsForFile,
} from '../../../shared/utils/orphanUtils';
import { getParentFolder } from '../watch/folderMover';

export interface RecommendLinksOptions {
	topK?: number;
	excludedPaths?: readonly string[];
}

/** 벡터 L2 정규화 수행 */
function normalizeVector(vec: number[]): number[] | null {
	let normSq = 0;
	for (let i = 0; i < vec.length; i++) {
		normSq += vec[i] * vec[i];
	}
	const norm = Math.sqrt(normSq);
	if (norm <= 0) return null;
	const out = new Array<number>(vec.length);
	for (let i = 0; i < vec.length; i++) {
		out[i] = vec[i] / norm;
	}
	return out;
}

/** 파일별 하위 청크 임베딩을 Mean Pooling 후 L2 정규화한 문서 벡터 맵 생성 */
function buildDocumentEmbeddingMap(
	childChunks: readonly ChildChunk[],
): Map<string, number[]> {
	const grouped = new Map<string, Array<number[] | Float32Array>>();
	for (const chunk of childChunks) {
		if (!chunk.embedding || chunk.embedding.length === 0) continue;
		const normPath = normalizePath(chunk.path);
		let list = grouped.get(normPath);
		if (!list) {
			list = [];
			grouped.set(normPath, list);
		}
		list.push(chunk.embedding);
	}

	const result = new Map<string, number[]>();
	for (const [path, embeddings] of grouped.entries()) {
		const dim = embeddings[0].length;
		const mean = new Array<number>(dim).fill(0);
		let validCount = 0;

		for (const emb of embeddings) {
			if (emb.length !== dim) continue;
			for (let k = 0; k < dim; k++) {
				mean[k] += emb[k];
			}
			validCount++;
		}
		if (validCount === 0) continue;

		for (let k = 0; k < dim; k++) {
			mean[k] /= validCount;
		}
		const normalized = normalizeVector(mean);
		if (normalized) {
			result.set(path, normalized);
		}
	}

	return result;
}

/** 정규화된 두 벡터 간 코사인 유사도 (내적) */
function dotProduct(a: readonly number[], b: readonly number[]): number {
	const len = Math.min(a.length, b.length);
	let sum = 0;
	for (let i = 0; i < len; i++) {
		sum += a[i] * b[i];
	}
	return sum;
}

/** 제목·본문에서 2자 이상 검색 토큰 추출 */
function tokenizeText(text: string): Set<string> {
	const tokens = new Set<string>();
	const parts = text
		.toLowerCase()
		.split(/[\s\-_./\\,;:()[\]{}"'`!?<>]+/)
		.filter((t) => t.length >= 2);
	for (const p of parts) {
		tokens.add(p);
	}
	return tokens;
}

/** 상위 청크 맵에서 파일별 대표 스니펫 추출 */
function buildSnippetMap(parentChunks: readonly ParentChunk[]): Map<string, string> {
	const map = new Map<string, string>();
	for (const chunk of parentChunks) {
		const normPath = normalizePath(chunk.path);
		if (map.has(normPath)) continue;
		const cleaned = chunk.text.replace(/\s+/g, ' ').trim();
		if (cleaned) {
			map.set(normPath, cleaned.length > 160 ? `${cleaned.slice(0, 157)}...` : cleaned);
		}
	}
	return map;
}

/**
 * 지정된 고아노트와 연결하기 좋은 상위 추천 노트 목록을 반환합니다.
 */
export async function recommendLinksForOrphan(
	app: App,
	plugin: LuminaPlugin,
	orphanFile: TFile,
	opts: RecommendLinksOptions = {},
): Promise<OrphanLinkSuggestion[]> {
	const topK = opts.topK ?? 5;
	const excluded = opts.excludedPaths ? [...opts.excludedPaths] : [];
	const orphanPath = normalizePath(orphanFile.path);
	const allMarkdownFiles = app.vault?.getMarkdownFiles?.() ?? [];
	const markdownMap = new Map<string, TFile>();
	for (const f of allMarkdownFiles) {
		const np = normalizePath(f.path);
		if (np !== orphanPath && !isExcluded(np, excluded)) {
			markdownMap.set(np, f);
		}
	}
	if (markdownMap.size === 0) return [];

	const { inlinks } = buildVaultLinkCounts(app);

	// 1순위: 로컬 RAG 인덱서 임베딩 코사인 유사도 기반 추천
	const childChunks = plugin.indexer?.indexedChildChunks ?? [];
	if (childChunks.length > 0) {
		const docVectors = buildDocumentEmbeddingMap(childChunks);
		const orphanVec = docVectors.get(orphanPath);
		if (orphanVec) {
			const snippetMap = buildSnippetMap(plugin.indexer?.indexedParentChunks ?? []);
			const scored: OrphanLinkSuggestion[] = [];

			for (const [candidatePath, candidateVec] of docVectors.entries()) {
				const targetFile = markdownMap.get(candidatePath);
				if (!targetFile) continue;
				const sim = dotProduct(orphanVec, candidateVec);
				if (sim <= 0.15) continue;

				const backlinkCount = inlinks.get(candidatePath) ?? 0;
				scored.push({
					path: candidatePath,
					basename: targetFile.basename,
					folder: getParentFolder(candidatePath),
					score: Math.min(1, Math.max(0, sim)),
					reason: 'rag',
					backlinkCount,
					snippet: snippetMap.get(candidatePath),
				});
			}

			scored.sort((a, b) => {
				const diff = b.score - a.score;
				if (Math.abs(diff) > 0.02) return diff;
				return b.backlinkCount - a.backlinkCount || a.path.localeCompare(b.path);
			});

			if (scored.length > 0) {
				return scored.slice(0, topK);
			}
		}
	}

	// 2순위: RAG 미사용/미인덱싱 폴백 — 제목 토큰 + 공통 태그 + 같은 폴더 기반
	let orphanBodySample = '';
	try {
		orphanBodySample = (await app.vault.read(orphanFile)).slice(0, 1000);
	} catch {
		orphanBodySample = '';
	}
	const orphanTokens = tokenizeText(`${orphanFile.basename} ${orphanBodySample}`);
	const orphanTags = new Set(
		collectNormalizedTagsForFile(app, orphanFile).map((t) => t.toLowerCase()),
	);
	const orphanFolder = getParentFolder(orphanPath);

	const fallbackScored: OrphanLinkSuggestion[] = [];
	for (const [candidatePath, targetFile] of markdownMap.entries()) {
		const candidateTokens = tokenizeText(targetFile.basename);
		let overlap = 0;
		for (const tok of candidateTokens) {
			if (orphanTokens.has(tok)) overlap++;
		}
		const tokenScore =
			candidateTokens.size > 0 ? Math.min(0.6, (overlap / candidateTokens.size) * 0.6) : 0;

		const candidateTags = collectNormalizedTagsForFile(app, targetFile).map((t) =>
			t.toLowerCase(),
		);
		let sharedTags = 0;
		for (const t of candidateTags) {
			if (orphanTags.has(t)) sharedTags++;
		}
		const tagScore = orphanTags.size > 0 ? Math.min(0.3, sharedTags * 0.15) : 0;

		const candidateFolder = getParentFolder(candidatePath);
		const folderScore =
			orphanFolder && candidateFolder && orphanFolder === candidateFolder ? 0.15 : 0;

		const total = Math.min(1, tokenScore + tagScore + folderScore);
		if (total <= 0) continue;

		fallbackScored.push({
			path: candidatePath,
			basename: targetFile.basename,
			folder: candidateFolder,
			score: total,
			reason: 'metadata',
			backlinkCount: inlinks.get(candidatePath) ?? 0,
		});
	}

	fallbackScored.sort(
		(a, b) => b.score - a.score || b.backlinkCount - a.backlinkCount || a.path.localeCompare(b.path),
	);
	return fallbackScored.slice(0, topK);
}
