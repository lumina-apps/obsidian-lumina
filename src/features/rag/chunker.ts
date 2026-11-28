/**
 * 마크다운 문서를 구조(헤딩·문단·코드블록) 기반으로 상위/하위 청크로 분할하고,
 * 검색 보강용 구조 컨텍스트 접두사(contextPrefix)를 생성합니다.
 */

import type {
	ParentChunk,
	ChildChunk,
	RawDocument,
	MarkdownFilterOptions,
	DocumentMetadata,
} from '../../shared/types/rag.types';
import { preprocessMarkdown, extractFrontmatterMetadata } from '../../shared/utils/markdownPreprocessor';

interface HeadingSection {
	headingPath: string[];
	text: string;
}

interface AtomicRange {
	start: number;
	end: number;
}

const HEADING_REGEX = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const FENCE_OPEN_REGEX = /^\s*(```|~~~)/;
const MAX_CONTEXT_PREFIX_CHARS = 90;

/**
 * 마크다운 본문을 헤딩(#~######) 계층 섹션으로 분할합니다.
 * 펜스 코드블록(``` / ~~~) 내부의 `#` 주석은 헤딩으로 취급하지 않으며,
 * 본문 없이 하위 헤딩만 뒤따르는 단독 헤딩 줄은 빈 청크로 남기지 않습니다.
 */
function splitIntoHeadingSections(text: string): HeadingSection[] {
	const lines = text.split('\n');
	const sections: HeadingSection[] = [];
	const headingStack: Array<{ level: number; title: string }> = [];
	let currentLines: string[] = [];
	let currentHasBody = false;
	let activeFence: string | null = null;

	const flushSection = () => {
		const joined = currentLines.join('\n').trim();
		if (joined && currentHasBody) {
			sections.push({
				headingPath: headingStack.map(h => h.title),
				text: joined,
			});
		}
		currentLines = [];
		currentHasBody = false;
	};

	for (const line of lines) {
		const fenceMatch = FENCE_OPEN_REGEX.exec(line);
		if (fenceMatch) {
			const marker = fenceMatch[1];
			if (!activeFence) {
				activeFence = marker;
			} else if (line.trim().startsWith(activeFence)) {
				activeFence = null;
			}
			currentLines.push(line);
			currentHasBody = true;
			continue;
		}

		if (!activeFence) {
			const headingMatch = HEADING_REGEX.exec(line);
			if (headingMatch) {
				flushSection();
				const level = headingMatch[1].length;
				const title = headingMatch[2].trim();
				while (headingStack.length > 0 && headingStack[headingStack.length - 1].level >= level) {
					headingStack.pop();
				}
				headingStack.push({ level, title });
				currentLines.push(line);
				continue;
			}
		}

		if (line.trim().length > 0) {
			currentHasBody = true;
		}
		currentLines.push(line);
	}

	flushSection();
	return sections;
}

/**
 * 펜스 코드블록과 마크다운 표의 문자 오프셋 범위를 수집합니다.
 * 분할 시 해당 블록이 불필요하게 중간 절단되는 것을 방지하는 데 사용합니다.
 */
function findAtomicRanges(text: string): AtomicRange[] {
	const ranges: AtomicRange[] = [];
	const lines = text.split('\n');
	let offset = 0;

	let fenceChar: string | null = null;
	let fenceStart = -1;
	let tableStart = -1;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const lineStart = offset;
		const lineEnd = offset + line.length;
		offset = lineEnd + 1;

		const fenceMatch = FENCE_OPEN_REGEX.exec(line);
		if (fenceMatch) {
			if (!fenceChar) {
				if (tableStart !== -1) {
					ranges.push({ start: tableStart, end: Math.max(tableStart, lineStart - 1) });
					tableStart = -1;
				}
				fenceChar = fenceMatch[1];
				fenceStart = lineStart;
				continue;
			} else if (line.trim().startsWith(fenceChar)) {
				ranges.push({ start: fenceStart, end: lineEnd });
				fenceChar = null;
				fenceStart = -1;
				continue;
			}
		}

		if (fenceChar) continue;

		const isTableLine = /^\s*\|.+\|\s*$/.test(line);
		if (isTableLine) {
			if (tableStart === -1) tableStart = lineStart;
		} else if (tableStart !== -1) {
			ranges.push({ start: tableStart, end: Math.max(tableStart, lineStart - 1) });
			tableStart = -1;
		}
	}

	if (fenceChar && fenceStart !== -1) {
		ranges.push({ start: fenceStart, end: text.length });
	}
	if (tableStart !== -1) {
		ranges.push({ start: tableStart, end: text.length });
	}

	return ranges;
}

/**
 * maxSize 범위 내에서 가장 자연스러운 분할 끝 오프셋을 탐색합니다.
 * 경계가 없으면 정확히 start + maxSize를 반환합니다.
 */
function findSmartSplitEnd(
	text: string,
	start: number,
	maxSize: number,
	atomicRanges: readonly AtomicRange[],
): number {
	const hardEnd = Math.min(start + maxSize, text.length);
	if (hardEnd >= text.length) return text.length;

	const minAcceptableEnd = start + Math.max(1, Math.floor(maxSize * 0.35));

	// 1. 원자 블록(코드블록/표)을 중간에 자르는 경우 블록 직전으로 후퇴 시도
	for (const range of atomicRanges) {
		if (range.start > minAcceptableEnd && range.start < hardEnd && range.end > hardEnd) {
			return range.start;
		}
	}

	const slice = text.slice(start, hardEnd);

	// 2. 문단 경계 (\n\n)
	const paraIdx = slice.lastIndexOf('\n\n');
	if (paraIdx !== -1 && start + paraIdx >= minAcceptableEnd) {
		return start + paraIdx + 2;
	}

	// 3. 줄바꿈 경계 (\n)
	const lineIdx = slice.lastIndexOf('\n');
	if (lineIdx !== -1 && start + lineIdx >= minAcceptableEnd) {
		return start + lineIdx + 1;
	}

	// 4. 문장 경계 (. ! ? 。 ！ ？ 뒤 공백)
	const sentenceMatches = Array.from(slice.matchAll(/[.!?。！？](?=\s|$)/g));
	if (sentenceMatches.length > 0) {
		const lastMatch = sentenceMatches[sentenceMatches.length - 1];
		if (lastMatch.index !== undefined) {
			const candidate = start + lastMatch.index + 1;
			if (candidate >= minAcceptableEnd) {
				return candidate;
			}
		}
	}

	// 5. 공백 경계
	const spaceMatch = /\s(?=\S*$)/.exec(slice);
	if (spaceMatch && spaceMatch.index !== undefined) {
		const candidate = start + spaceMatch.index + 1;
		if (candidate >= minAcceptableEnd) {
			return candidate;
		}
	}

	// 6. 경계가 없는 연속 문자열 폴백 (기존 문자 슬라이싱과 동일)
	return hardEnd;
}

/**
 * 텍스트를 최대 크기와 겹침을 지켜 경계 우선 방식으로 분할합니다.
 */
function splitTextSmart(text: string, maxSize: number, overlap: number): string[] {
	const trimmed = text.trim();
	if (!trimmed) return [];
	if (trimmed.length <= maxSize) return [trimmed];

	const atomicRanges = findAtomicRanges(trimmed);
	const chunks: string[] = [];
	let start = 0;

	while (start < trimmed.length) {
		const end = findSmartSplitEnd(trimmed, start, maxSize, atomicRanges);
		const piece = trimmed.slice(start, end).trim();
		if (piece) {
			chunks.push(piece);
		}
		if (end >= trimmed.length) break;
		start = Math.max(start + 1, end - overlap);
	}

	return chunks;
}

/** 외부 메타데이터와 프론트매터 파싱 메타데이터를 병합합니다. */
function mergeMetadata(
	frontmatterMeta: DocumentMetadata,
	externalMeta?: DocumentMetadata,
): DocumentMetadata {
	const title = externalMeta?.title?.trim() || frontmatterMeta.title?.trim();
	const tagSet = new Set<string>();
	for (const t of externalMeta?.tags ?? []) {
		const clean = t.replace(/^#+/, '').trim();
		if (clean) tagSet.add(clean);
	}
	for (const t of frontmatterMeta.tags ?? []) {
		const clean = t.replace(/^#+/, '').trim();
		if (clean) tagSet.add(clean);
	}
	const aliasSet = new Set<string>([
		...(externalMeta?.aliases ?? []),
		...(frontmatterMeta.aliases ?? []),
	]);

	return {
		...(title ? { title } : {}),
		...(tagSet.size > 0 ? { tags: Array.from(tagSet).slice(0, 8) } : {}),
		...(aliasSet.size > 0 ? { aliases: Array.from(aliasSet).slice(0, 5) } : {}),
	};
}

/**
 * 청크의 검색·임베딩 품질 보강을 위한 경량 구조 문맥 접두사를 생성합니다.
 * 보일러플레이트 라벨 없이 파일명·제목·헤딩 경로·상위 태그만 압축 포함해
 * 작은 하위 청크(200자)의 임베딩 벡터가 희석되지 않도록 합니다.
 */
export function buildContextPrefix(
	path: string,
	metadata: DocumentMetadata,
	headingPath: readonly string[],
): string {
	const cleanPath = path.replace(/\.md$/i, '').trim();
	const basename = (cleanPath.split(/[/\\]/).pop() ?? cleanPath).trim();
	const titlePart =
		metadata.title && metadata.title !== basename
			? `${basename} (${metadata.title})`
			: basename;

	const headerSegments: string[] = [];
	if (titlePart) headerSegments.push(titlePart);
	if (headingPath.length > 0) headerSegments.push(headingPath.join(' > '));

	const tagSegment =
		metadata.tags && metadata.tags.length > 0
			? metadata.tags
					.slice(0, 3)
					.map(tag => (tag.startsWith('#') ? tag : `#${tag}`))
					.join(' ')
			: '';

	const combined = [headerSegments.join(' | '), tagSegment].filter(Boolean).join(' ');
	if (!combined) return '';
	if (combined.length <= MAX_CONTEXT_PREFIX_CHARS) {
		return combined;
	}
	return `${combined.slice(0, MAX_CONTEXT_PREFIX_CHARS - 3)}...`;
}

/**
 * 마크다운 문서를 구조 기반 상위/하위 청크로 분할합니다.
 * 사이즈 및 겹침은 문자 수 기준이며, 헤딩·문단·코드블록 경계를 우선 보존합니다.
 */
export function chunkDocument(
	doc: RawDocument,
	parentChunkSize: number,
	parentChunkOverlap: number,
	childChunkSize: number,
	childChunkOverlap: number,
	filterOptions?: MarkdownFilterOptions,
	metadata?: DocumentMetadata,
): { parentChunks: ParentChunk[]; childChunks: ChildChunk[] } {
	const text = preprocessMarkdown(doc.content, filterOptions);

	if (!text.trim()) return { parentChunks: [], childChunks: [] };

	const safeParentSize = Math.max(1, parentChunkSize);
	const safeParentOverlap = Math.min(Math.max(0, parentChunkOverlap), safeParentSize - 1);
	const safeChildSize = Math.max(1, childChunkSize);
	const safeChildOverlap = Math.min(Math.max(0, childChunkOverlap), safeChildSize - 1);

	const mergedMeta = mergeMetadata(extractFrontmatterMetadata(doc.content), metadata);
	const sections = splitIntoHeadingSections(text);
	const effectiveSections: HeadingSection[] =
		sections.length > 0 ? sections : [{ headingPath: [], text: text.trim() }];

	const parentChunks: ParentChunk[] = [];
	const childChunks: ChildChunk[] = [];

	let pIndex = 0;
	let totalChildIndex = 0;

	for (const section of effectiveSections) {
		const parentTexts = splitTextSmart(section.text, safeParentSize, safeParentOverlap);
		const contextPrefix = buildContextPrefix(doc.path, mergedMeta, section.headingPath);
		const headingPathProp = section.headingPath.length > 0 ? section.headingPath : undefined;

		for (const pText of parentTexts) {
			const parentId = `${doc.path}#parent_${pIndex}`;
			parentChunks.push({
				id: parentId,
				path: doc.path,
				text: pText,
				chunkIndex: pIndex,
				...(headingPathProp ? { headingPath: headingPathProp } : {}),
				...(contextPrefix ? { contextPrefix } : {}),
			});

			const childTexts = splitTextSmart(pText, safeChildSize, safeChildOverlap);
			let cIndex = 0;
			for (const cText of childTexts) {
				childChunks.push({
					id: `${parentId}#child_${cIndex}`,
					parentId,
					path: doc.path,
					text: cText,
					chunkIndex: totalChildIndex,
					...(headingPathProp ? { headingPath: headingPathProp } : {}),
					...(contextPrefix ? { contextPrefix } : {}),
				});
				cIndex++;
				totalChildIndex++;
			}

			pIndex++;
		}
	}

	return { parentChunks, childChunks };
}