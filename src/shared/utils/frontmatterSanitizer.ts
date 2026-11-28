/**
 * LLM이 생성한 프론트매터 데이터(tags, description) 정제 공통 유틸리티.
 * FrontmatterManager와 BatchStudio의 프론트매터 레시피에서 공통 사용합니다.
 */

import type { ResponseFormatOptions } from '../types/llm.types';

/** 프론트매터(tags, description) 생성용 공통 Structured Output 스키마 */
export const FRONTMATTER_RESPONSE_FORMAT: ResponseFormatOptions = {
	type: 'json_schema',
	jsonSchema: {
		name: 'frontmatter_metadata',
		description: 'Markdown note tags and one-sentence summary description',
		schema: {
			type: 'object',
			properties: {
				tags: {
					type: 'array',
					items: { type: 'string' },
				},
				description: { type: 'string' },
			},
			required: ['tags', 'description'],
			additionalProperties: false,
		},
		strict: true,
	},
};

const PLACEHOLDER_TAG_PATTERNS: readonly RegExp[] = [
	/^tag\d*$/i,
	/^example\d*$/i,
	/^placeholder\d*$/i,
	/^sample\d*$/i,
	/^keyword\d*$/i,
	/^topic\d*$/i,
	/^태그\d*$/,
	/^예시\d*$/,
	/^키워드\d*$/,
	/^<.*>$/,
];

const PLACEHOLDER_DESCRIPTIONS = new Set<string>([
	"one-sentence summary of the document's core content",
	'one-sentence summary of the document',
	'summary of the document',
]);

/** 정제된 LLM 프론트매터 생성 결과 */
export interface SanitizedFrontmatterData {
	tags: string[];
	description: string;
}

/**
 * LLM이 생성한 프론트매터 JSON 데이터에서 플레이스홀더·중복·선행 # 기호 등을 정제합니다.
 * 유효한 태그와 설명이 모두 없으면 null을 반환합니다.
 */
export function sanitizeGeneratedFrontmatterData(raw: unknown): SanitizedFrontmatterData | null {
	if (typeof raw !== 'object' || raw === null) {
		return null;
	}
	const record = raw as Record<string, unknown>;
	const rawTags = Array.isArray(record.tags) ? record.tags : [];
	const rawDesc = typeof record.description === 'string' ? record.description.trim() : '';

	const cleanedTags: string[] = [];
	const seenLower = new Set<string>();

	for (const item of rawTags) {
		if (typeof item !== 'string') continue;
		const cleaned = item.trim().replace(/^#+/, '').trim();
		if (!cleaned) continue;
		if (PLACEHOLDER_TAG_PATTERNS.some((pattern) => pattern.test(cleaned))) continue;

		const lower = cleaned.toLowerCase();
		if (seenLower.has(lower)) continue;
		seenLower.add(lower);
		cleanedTags.push(cleaned);
		if (cleanedTags.length >= 3) break;
	}

	const isPlaceholderDesc =
		!rawDesc ||
		/^<.*>$/.test(rawDesc) ||
		PLACEHOLDER_DESCRIPTIONS.has(rawDesc.toLowerCase());
	const description = isPlaceholderDesc ? '' : rawDesc;

	if (cleanedTags.length === 0 && !description) {
		return null;
	}

	return {
		tags: cleanedTags,
		description,
	};
}

/** 프론트매터의 tags 속성(배열 또는 쉼표 구분 문자열)을 정규화된 문자열 배열로 변환합니다. */
export function normalizeFrontmatterTags(rawTags: unknown): string[] {
	if (Array.isArray(rawTags)) {
		return rawTags
			.filter((t): t is string => typeof t === 'string')
			.map((t) => t.trim().replace(/^#+/, '').trim())
			.filter((t) => t.length > 0);
	}
	if (typeof rawTags === 'string') {
		return rawTags
			.split(',')
			.map((t) => t.trim().replace(/^#+/, '').trim())
			.filter((t) => t.length > 0);
	}
	return [];
}
