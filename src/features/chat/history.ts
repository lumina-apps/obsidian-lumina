/**
 * history.ts
 *
 * 채팅 세션을 Obsidian 볼트 내 마크다운으로 직렬화/역직렬화
 * - 저장: {historyPath}/{YYYY-MM-DD}_{sessionId}.md
 * - 포맷: YAML 프론트매터 + 마크다운 대화 블록 + 숨겨진 JSON (정확한 복원용)
 */

import { normalizePath, TFile, type App } from 'obsidian';
import type { ChatSession, UIChatMessage } from '../../shared/types/chat.types';

// ─── Save ─────────────────────────────────────────────────────────────────────

export async function saveSession(app: App, session: ChatSession, basePath: string): Promise<void> {
	// 포맷: YYMMDD_HHMM - [title]
	const dateObj = new Date(session.createdAt);
	const yy = String(dateObj.getFullYear()).slice(2);
	const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
	const dd = String(dateObj.getDate()).padStart(2, '0');
	const hh = String(dateObj.getHours()).padStart(2, '0');
	const min = String(dateObj.getMinutes()).padStart(2, '0');
	const safeTitle = session.title.replace(/[\\/:*?"<>|]/g, '_').trim();
	const filename = `${yy}${mm}${dd}_${hh}${min} - ${safeTitle}.md`;

	// 사용자 입력 경로 정규화 (중복 슬래시, 선행/후행 슬래시 제거)
	const normalBase = normalizePath(basePath.replace(/[\/\\]+$/, ''));
	const filePath = normalizePath(`${normalBase}/${filename}`);

	const content = serializeSession(session);

	// 폴더가 없으면 생성
	if (!(await app.vault.adapter.exists(normalBase))) {
		await app.vault.createFolder(normalBase);
	}

	// 기존 파일 찾기 (sessionId 기준)
	const files = app.vault.getFiles().filter(file => file.path.startsWith(normalBase) && file.extension === 'md');
	let existingFile = files.find(f => {
		const cache = app.metadataCache.getFileCache(f);
		return cache?.frontmatter?.id === session.id;
	});

	// 캐시가 아직 동기화되지 않은 경우를 대비한 텍스트 기반 폴백 검색
	if (!existingFile) {
		for (const f of files) {
			try {
				const text = await app.vault.cachedRead(f);
				const idMatch = text.match(/^id:\s*(.+)$/m);
				if (idMatch && idMatch[1].trim() === session.id) {
					existingFile = f;
					break;
				}
			} catch (e) {}
		}
	}

	if (existingFile) {
		if (existingFile.name !== filename) {
			await app.vault.rename(existingFile, filePath);
		}
		await app.vault.modify(existingFile, content);
	} else {
		await app.vault.create(filePath, content);
	}
}

// ─── Load & Delete ─────────────────────────────────────────────────────────────

/** 히스토리 폴더의 모든 마크다운 파일을 읽어 세션 메타데이터 목록을 반환합니다. */
export async function loadSessionsList(app: App, basePath: string): Promise<ChatSession[]> {
	const normalBase = normalizePath(basePath.replace(/[\/\\]+$/, ''));
	const folderExists = await app.vault.adapter.exists(normalBase);
	if (!folderExists) return [];

	const prefix = normalBase === '' ? '' : normalBase + '/';
	const files = app.vault.getFiles().filter(file => file.path.startsWith(prefix) && file.extension === 'md');
	const sessions: ChatSession[] = [];

	for (const file of files) {
		const cache = app.metadataCache.getFileCache(file);
		let fm = cache?.frontmatter;

		// Obsidian 캐시가 아직 동기화되지 않은 경우 (새로 생성 직후 등)
		if (!fm) {
			try {
				const content = await app.vault.cachedRead(file);
				const idMatch = content.match(/^id:\s*(.+)$/m);
				if (idMatch) {
					const titleMatch = content.match(/^title:\s*(.+)$/m);
					const createdMatch = content.match(/^created:\s*(.+)$/m);
					const updatedMatch = content.match(/^updated:\s*(.+)$/m);
					const modelMatch = content.match(/^model:\s*(.+)$/m);
					const providerMatch = content.match(/^provider:\s*(.+)$/m);
					
					let parsedTitle = '새 대화';
					if (titleMatch) {
						try { parsedTitle = JSON.parse(titleMatch[1]); } catch { parsedTitle = titleMatch[1].trim(); }
					}

					fm = {
						id: idMatch[1].trim(),
						title: parsedTitle,
						created: createdMatch ? createdMatch[1].trim() : file.stat.ctime,
						updated: updatedMatch ? updatedMatch[1].trim() : file.stat.mtime,
						model: modelMatch ? modelMatch[1].trim() : '',
						provider: providerMatch ? providerMatch[1].trim() : ''
					};
				}
			} catch (e) {
				// 읽기 실패 시 무시
			}
		}

		if (fm && fm.id) {
			sessions.push({
				id: fm.id,
				title: fm.title || '새 대화',
				createdAt: new Date(fm.created).getTime(),
				updatedAt: new Date(fm.updated).getTime(),
				providerId: fm.provider || '',
				modelId: fm.model || '',
				messages: [], // 목록에서는 메시지 본문을 로드하지 않음 (최적화)
			});
		}
	}

	// 최신순 정렬
	return sessions.sort((a, b) => b.updatedAt - a.updatedAt);
}

/** 특정 세션 ID를 가진 파일을 찾아 파싱하여 전체 ChatSession 객체(메시지 포함)를 복원합니다. */
export async function loadSession(app: App, sessionId: string, basePath: string): Promise<ChatSession | null> {
	const normalBase = normalizePath(basePath.replace(/[\/\\]+$/, ''));
	const files = app.vault.getFiles().filter(file => file.path.startsWith(normalBase) && file.extension === 'md');
	
	const file = files.find(f => {
		const cache = app.metadataCache.getFileCache(f);
		return cache?.frontmatter?.id === sessionId;
	});

	if (!file) return null;

	const content = await app.vault.read(file);
	
	// HTML 주석으로 숨겨둔 JSON 블록 찾기 (ES5 호환을 위해 /s 대신 [\\s\\S]* 사용)
	const match = content.match(/<!-- LUMINA_HISTORY_DATA:\s*([\s\S]*?)\s*-->/);
	if (match && match[1]) {
		try {
			const parsed = JSON.parse(match[1]);
			// 저장된 전체 세션을 반환 (포맷에 맞춤)
			return parsed as ChatSession;
		} catch (e) {
			console.error('Lumina: Failed to parse history JSON data', e);
		}
	}

	return null;
}

/** 특정 세션 파일을 삭제합니다. */
export async function deleteSession(app: App, sessionId: string, basePath: string): Promise<boolean> {
	const normalBase = normalizePath(basePath.replace(/[\/\\]+$/, ''));
	const files = app.vault.getFiles().filter(file => file.path.startsWith(normalBase) && file.extension === 'md');
	
	const file = files.find(f => {
		const cache = app.metadataCache.getFileCache(f);
		return cache?.frontmatter?.id === sessionId;
	});

	if (file) {
		await app.vault.delete(file);
		return true;
	}
	return false;
}

// ─── Serialize ────────────────────────────────────────────────────────────────

function serializeSession(session: ChatSession): string {
	const frontmatter = [
		'---',
		`id: ${session.id}`,
		`title: ${JSON.stringify(session.title)}`,
		`provider: ${session.providerId}`,
		`model: ${session.modelId}`,
		`created: ${new Date(session.createdAt).toISOString()}`,
		`updated: ${new Date(session.updatedAt).toISOString()}`,
		'---',
		'',
	].join('\n');

	const body = session.messages
		.filter(m => m.role !== 'system')
		.map(m => {
			const label = m.role === 'user' ? '**👤 You**' : `**✦ Lumina** _(${m.model ?? ''})_`;
			const time = new Date(m.timestamp).toLocaleTimeString();
			return `${label} · ${time}\n\n${m.content}\n`;
		})
		.join('\n---\n\n');

	// 완벽한 복원을 위해 숨겨진 JSON 데이터를 맨 끝에 추가
	const rawDataBlock = `\n\n<!-- LUMINA_HISTORY_DATA: ${JSON.stringify(session)} -->\n`;

	return frontmatter + body + rawDataBlock;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function generateTitle(messages: UIChatMessage[]): string {
	const first = messages.find(m => m.role === 'user');
	if (!first) return '새 대화';
	return first.content.slice(0, 15) + (first.content.length > 15 ? '…' : '');
}
