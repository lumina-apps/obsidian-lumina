/**
 * 자체 구현 경량 BM25 (Okapi BM25) 알고리즘.
 * RAG 문서 청크 대상 키워드 기반 검색을 수행합니다.
 */

import type { DocumentChunk } from '../../shared/types/rag.types';

/**
 * 텍스트 토큰화 (Uni-gram + CJK Bi-gram).
 * 한글 등 CJK 문자는 2-gram 토큰을 추가 생성합니다.
 */
export function tokenize(text: string): string[] {
	if (!text) return [];
	const tokens: string[] = [];
	
	const words = text.toLowerCase().split(/[\s,.\-!?"'()[\]{}<>:;]+/);
	
	for (const word of words) {
		if (!word) continue;
		tokens.push(word);
		
		if (/[가-힣]/.test(word) && word.length >= 2) {
			for (let i = 0; i < word.length - 1; i++) {
				tokens.push(word.substring(i, i + 2));
			}
		}
	}
	return tokens;
}

/**
 * 쿼리와 문서 청크에 대해 BM25 점수를 계산합니다.
 * @param query 검색어
 * @param chunks 검색 대상 문서 청크 배열
 * @param k1 단어 빈도 포화도 파라미터 (기본: 1.2)
 * @param b 문서 길이 정규화 파라미터 (기본: 0.75)
 */
export function calculateBM25(
	query: string,
	chunks: DocumentChunk[],
	k1 = 1.2,
	b = 0.75
): { chunk: DocumentChunk; score: number }[] {
	if (!query || chunks.length === 0) {
		return chunks.map(c => ({ chunk: c, score: 0 }));
	}

	const queryTokens = tokenize(query);
	if (queryTokens.length === 0) {
		return chunks.map(c => ({ chunk: c, score: 0 }));
	}

	const N = chunks.length;
	let totalDocLength = 0;
	
	const docTokensMap = new Map<number, string[]>();
	const df = new Map<string, number>();

	// 1. 문서 토큰화 및 DF 계산
	for (let i = 0; i < N; i++) {
		const chunk = chunks[i];
		const tokens = tokenize(chunk.text);
		docTokensMap.set(i, tokens);
		totalDocLength += tokens.length;

		const uniqueTokens = new Set(tokens);
		for (const token of uniqueTokens) {
			df.set(token, (df.get(token) || 0) + 1);
		}
	}

	const avgDl = totalDocLength / Math.max(N, 1);

	// 2. 쿼리 토큰별 IDF 계산 (Robertson-Sparck Jones 공식)
	const idf = new Map<string, number>();
	for (const token of queryTokens) {
		const docFreq = df.get(token) || 0;
		const val = Math.max((N - docFreq + 0.5) / (docFreq + 0.5), 0.01);
		idf.set(token, Math.log(1 + val));
	}

	// 3. 문서별 BM25 점수 계산
	const results = chunks.map((chunk, i) => {
		const docTokens = docTokensMap.get(i)!;
		const docLen = docTokens.length;

		const tf = new Map<string, number>();
		for (const token of docTokens) {
			tf.set(token, (tf.get(token) || 0) + 1);
		}

		let score = 0;
		for (const token of queryTokens) {
			const tokenTf = tf.get(token) || 0;
			if (tokenTf > 0) {
				const tokenIdf = idf.get(token)!;
				const numerator = tokenTf * (k1 + 1);
				const denominator = tokenTf + k1 * (1 - b + b * (docLen / avgDl));
				score += tokenIdf * (numerator / denominator);
			}
		}

		return { chunk, score };
	});

	return results;
}
