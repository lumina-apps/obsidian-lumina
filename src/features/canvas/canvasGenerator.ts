/**
 * canvasGenerator.ts
 *
 * Canvas 파일 저장 및 Obsidian에서 자동으로 열기를 담당하는 오케스트레이터.
 */

import type { App } from 'obsidian';
import { Notice, TFile, TFolder } from 'obsidian';
import { collectGraph, buildCanvasData, addFolderGroups } from './canvasBuilder';
import type { CanvasBuildOptions } from './canvasTypes';
import { t } from '../../shared/locales/helpers';

// ─── 파일명 생성 ──────────────────────────────────────────────────────────────

function getTimestamp(): string {
	const now = new Date();
	const pad = (n: number) => n.toString().padStart(2, '0');
	return `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
}

async function resolveOutputPath(app: App, baseName: string, outputFolder: string): Promise<string> {
	// 출력 폴더 생성 (없을 경우)
	if (!(await app.vault.adapter.exists(outputFolder))) {
		await app.vault.createFolder(outputFolder);
	}

	const base = `${outputFolder}/${baseName}`;
	let candidate = `${base}.canvas`;

	if (!(await app.vault.adapter.exists(candidate))) {
		return candidate;
	}

	// 중복 시 suffix 추가
	let i = 1;
	while (await app.vault.adapter.exists(`${base}-${i}.canvas`)) {
		i++;
	}
	return `${base}-${i}.canvas`;
}

// ─── 단일 노트 기준 Canvas 생성 ──────────────────────────────────────────────

/**
 * 단일 노트를 루트로 Canvas 파일을 생성하고 Obsidian에서 엽니다.
 */
export async function generateCanvasForFile(
	app: App,
	file: TFile,
	opts: CanvasBuildOptions,
	outputFolder: string,
	showGroups: boolean = false,
): Promise<void> {
	try {
		const roots = [file];
		const collected = collectGraph(app, roots, opts);

		const truncated = collected.nodeMap.size >= opts.maxNodes;

		let canvasData = buildCanvasData(collected, roots, opts);

		if (showGroups) {
			canvasData = addFolderGroups(canvasData, collected.nodeMap);
		}

		const json = JSON.stringify(canvasData, null, 2);
		const baseName = `${file.basename}-canvas-${getTimestamp()}`;
		const outputPath = await resolveOutputPath(app, baseName, outputFolder);

		await app.vault.create(outputPath, json);

		if (truncated) {
			new Notice(t('canvas.noticeTruncated', { max: opts.maxNodes }), 5000);
		}

		// 생성된 캔버스 파일 열기
		const canvasFile = app.vault.getFileByPath(outputPath);
		if (canvasFile) {
			await app.workspace.getLeaf(false).openFile(canvasFile);
		}

		new Notice(t('canvas.noticeCreated', { name: file.basename }), 3000);
	} catch (e) {
		console.error('[Lumina Canvas] 생성 실패:', e);
		new Notice(t('canvas.noticeError'), 5000);
	}
}

// ─── 폴더 기준 Canvas 생성 ───────────────────────────────────────────────────

/**
 * 폴더 내 파일들을 루트로 Canvas 파일을 생성합니다.
 * folderDepth에 따라 하위 폴더는 별도 캔버스로 분리 생성합니다.
 */
function getFilesRecursively(folder: TFolder, maxDepth: number, currentDepth: number = 0): TFile[] {
	let files: TFile[] = [];
	for (const child of folder.children) {
		if (child instanceof TFile && child.extension === 'md') {
			files.push(child);
		} else if (child instanceof TFolder && currentDepth < maxDepth) {
			files = files.concat(getFilesRecursively(child, maxDepth, currentDepth + 1));
		}
	}
	return files;
}

export async function generateCanvasForFolder(
	app: App,
	folder: TFolder,
	opts: CanvasBuildOptions,
	outputFolder: string,
	showGroups: boolean = false,
): Promise<void> {
	try {
		const allFiles = getFilesRecursively(folder, opts.folderDepth);

		if (allFiles.length === 0) {
			new Notice(t('canvas.noticeNoFiles'), 3000);
			return;
		}

		const collected = collectGraph(app, allFiles, opts);
		const truncated = collected.nodeMap.size >= opts.maxNodes;

		let canvasData = buildCanvasData(collected, allFiles, opts);
		if (showGroups) {
			canvasData = addFolderGroups(canvasData, collected.nodeMap);
		}

		const json = JSON.stringify(canvasData, null, 2);
		const baseName = `${folder.name}-canvas-${getTimestamp()}`;
		const outputPath = await resolveOutputPath(app, baseName, outputFolder);
		await app.vault.create(outputPath, json);

		if (truncated) {
			new Notice(t('canvas.noticeTruncated', { max: opts.maxNodes }), 5000);
		} else {
			new Notice(t('canvas.noticeFolderCreated', { name: folder.name, count: 1 }), 3000);
		}

		const canvasFile = app.vault.getFileByPath(outputPath);
		if (canvasFile) {
			await app.workspace.getLeaf(false).openFile(canvasFile);
		}
	} catch (e) {
		console.error('[Lumina Canvas] 폴더 캔버스 생성 실패:', e);
		new Notice(t('canvas.noticeError'), 5000);
	}
}
