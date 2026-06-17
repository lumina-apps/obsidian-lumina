/**
 * 개별 파일 읽기 + 전처리 + 청킹 + 해시 비교를 담당합니다.
 */

import { App, TFile } from 'obsidian';
import type { DocumentChunk, ParseBinaryFn } from '../../shared/types/rag.types';
import { hashString } from '../../shared/utils/hash';
import { preprocessMarkdown } from '../../shared/utils/markdownPreprocessor';
import { DocumentParserRouter } from './parsers/DocumentParserRouter';
import { chunkDocument } from './chunker';

export interface ReadAndPrepareResult {
	chunks: DocumentChunk[];
	contentHash: number;
	/** 본문 해시 동일 시 mtime만 갱신 */
	skip: boolean;
}

/**
 * 파일 1개를 읽고 청킹까지 준비합니다.
 * @param file 대상 파일
 * @param app Obsidian App 인스턴스
 * @param parseBinaryFn 바이너리 파일 파싱 함수
 * @param chunkSize 청크 크기 (문자 수)
 * @param chunkOverlap 청크 겹침 크기 (문자 수)
 * @param fileHashes 기존 파일별 본문 해시 맵
 * @param indexedPaths 기존 인덱싱된 경로 Set
 * @returns skip=true: 해시 동일, skip=false chunks=[]: 빈 파일, chunks≠[]: 임베딩 필요
 */
export async function readAndPrepareFile(
	file: TFile,
	app: App,
	parseBinaryFn: ParseBinaryFn,
	chunkSize: number,
	chunkOverlap: number,
	fileHashes: Record<string, number>,
	indexedPaths: Set<string>,
): Promise<ReadAndPrepareResult> {
	const ext = file.extension.toLowerCase();
	let content = '';

	if (['pdf', 'docx', 'xlsx', 'xls'].includes(ext)) {
		const buffer = await app.vault.readBinary(file);
		content = await parseBinaryFn(buffer, ext);
	} else {
		const textContent = await app.vault.read(file);
		content = await DocumentParserRouter.parseText(textContent, ext);
	}

	if (!content || !content.trim()) {
		return { chunks: [], contentHash: 0, skip: false };
	}

	const preprocessedText = preprocessMarkdown(content);
	const contentHash = hashString(preprocessedText);

	// 해시 동일 + 기존 청크 존재 → 재임베딩 불필요
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