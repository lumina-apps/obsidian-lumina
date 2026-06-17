/**
 * fileProcessor.ts
 *
 * 개별 파일 읽기 + 전처리 + 청킹 + 해시 비교를 담당합니다.
 * processFiles()에서 병렬로 호출됩니다.
 */

import { TFile } from 'obsidian';
import type { DocumentChunk } from '../../shared/types/rag.types';
import { hashString } from '../../shared/utils/hash';
import { preprocessMarkdown } from '../../shared/utils/markdownPreprocessor';
import { DocumentParserRouter } from './parsers/DocumentParserRouter';
import { chunkDocument } from './chunker';

export interface ReadAndPrepareResult {
	chunks: DocumentChunk[];
	contentHash: number;
	/** true = 본문 해시 동일 → mtime만 갱신하면 됨 */
	skip: boolean;
}

/**
 * 파일 1개를 읽고 청킹까지 준비합니다.
 *
 * @param file            대상 파일
 * @param parseBinaryFn   바이너리 파일 파싱 함수
 * @param chunkSize       청크 크기 (문자 수)
 * @param chunkOverlap    청크 겹침 크기 (문자 수)
 * @param fileHashes      기존 파일별 본문 해시 맵
 * @param indexedPaths    기존 인덱싱된 경로 Set
 * @param readFn          텍스트 파일 읽기 함수 (app.vault.read)
 * @param readBinaryFn    바이너리 파일 읽기 함수 (app.vault.readBinary)
 *
 * @returns
 *   - skip=true  : 본문 해시 동일 → mtime만 갱신하면 됨
 *   - skip=false, chunks=[] : 빈 파일 → mtime만 기록
 *   - skip=false, chunks≠[] : 임베딩 필요
 */
export async function readAndPrepareFile(
	file: TFile,
	parseBinaryFn: (buffer: ArrayBuffer, ext: string) => Promise<string>,
	chunkSize: number,
	chunkOverlap: number,
	fileHashes: Record<string, number>,
	indexedPaths: Set<string>,
	readFn: (file: TFile) => Promise<string>,
	readBinaryFn: (file: TFile) => Promise<ArrayBuffer>,
): Promise<ReadAndPrepareResult> {
	const ext = file.extension.toLowerCase();
	let content = '';

	if (['pdf', 'docx', 'xlsx', 'xls'].includes(ext)) {
		const buffer = await readBinaryFn(file);
		content = await parseBinaryFn(buffer, ext);
	} else {
		const textContent = await readFn(file);
		content = await DocumentParserRouter.parseText(textContent, ext);
	}

	if (!content || !content.trim()) {
		return { chunks: [], contentHash: 0, skip: false };
	}

	const preprocessedText = preprocessMarkdown(content);
	const contentHash = hashString(preprocessedText);

	// 해시 동일 + 기존 청크 존재 → 재임베딩 불필요 (mtime만 변경된 경우)
	if (fileHashes[file.path] === contentHash && indexedPaths.has(file.path)) {
		return { chunks: [], contentHash, skip: true };
	}

	const chunks = chunkDocument(
		{ path: file.path, content, mtime: file.stat.mtime },
		chunkSize,
		chunkOverlap,
	);

	return { chunks, contentHash, skip: false };
}