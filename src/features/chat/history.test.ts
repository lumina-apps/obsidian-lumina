import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TFile, TFolder, type App } from 'obsidian';
import { saveSession, loadSession } from './history';
import type { ChatSession } from '../../shared/types/chat.types';

describe('chat history persistence', () => {
	let mockApp: App;
	let virtualFiles: Map<string, { content: string; file: TFile }>;

	beforeEach(() => {
		virtualFiles = new Map();

		mockApp = {
			vault: {
				adapter: {
					exists: vi.fn().mockResolvedValue(true),
				},
				createFolder: vi.fn().mockResolvedValue(undefined),
				getAbstractFileByPath: vi.fn().mockImplementation((path: string) => {
					// Normalize path without trailing slash
					const cleanPath = path.replace(/[/\\]+$/, '');
					const folder = new TFolder();
					folder.path = cleanPath;
					for (const [filePath, fileData] of virtualFiles.entries()) {
						if (filePath.startsWith(cleanPath + '/')) {
							folder.children.push(fileData.file);
						}
					}
					return folder;
				}),
				create: vi.fn().mockImplementation(async (filePath: string, content: string) => {
					const file = new TFile();
					file.path = filePath;
					file.name = filePath.split('/').pop()!;
					file.extension = 'md';
					file.stat = { ctime: Date.now(), mtime: Date.now(), size: content.length };
					virtualFiles.set(filePath, { content, file });
					return file;
				}),
				modify: vi.fn().mockImplementation(async (file: TFile, content: string) => {
					virtualFiles.set(file.path, { content, file });
				}),
				read: vi.fn().mockImplementation(async (file: TFile) => {
					return virtualFiles.get(file.path)?.content || '';
				}),
				cachedRead: vi.fn().mockImplementation(async (file: TFile) => {
					return virtualFiles.get(file.path)?.content || '';
				}),
				rename: vi.fn().mockImplementation(async (file: TFile, newPath: string) => {
					const data = virtualFiles.get(file.path);
					if (data) {
						virtualFiles.delete(file.path);
						data.file.path = newPath;
						data.file.name = newPath.split('/').pop()!;
						virtualFiles.set(newPath, data);
					}
				}),
			},
			metadataCache: {
				getFileCache: vi.fn().mockReturnValue(null),
			},
			fileManager: {
				trashFile: vi.fn().mockResolvedValue(undefined),
			},
		} as unknown as App;
	});

	it('should save and restore session with --> in messages without corruption', async () => {
		const sessionWithArrows: ChatSession = {
			id: 'session-arrows-123',
			title: 'Mermaid Diagram Session',
			createdAt: 1700000000000,
			updatedAt: 1700000000000,
			providerId: 'anthropic',
			modelId: 'claude-3-5-sonnet',
			messages: [
				{
					id: 'msg-1',
					role: 'user',
					content: 'Explain state machine with A --> B transition and <!-- html comment -->',
					timestamp: 1700000000000,
					isStreaming: false,
				},
				{
					id: 'msg-2',
					role: 'assistant',
					content: '```mermaid\ngraph TD\n  A --> B\n  B --> C\n```',
					timestamp: 1700000005000,
					isStreaming: false,
				},
			],
		};

		// Save the session
		await saveSession(mockApp, sessionWithArrows, 'Lumina/History');

		// Verify it was written using V2 format
		const savedEntry = Array.from(virtualFiles.values())[0];
		expect(savedEntry).toBeDefined();
		expect(savedEntry.content).toContain('<!-- LUMINA_HISTORY_DATA_V2:');
		expect(savedEntry.content).not.toContain('<!-- LUMINA_HISTORY_DATA:');

		// Restore session
		const loaded = await loadSession(mockApp, 'session-arrows-123', 'Lumina/History');
		expect(loaded).not.toBeNull();
		expect(loaded?.id).toBe('session-arrows-123');
		expect(loaded?.messages.length).toBe(2);
		expect(loaded?.messages[0].content).toBe('Explain state machine with A --> B transition and <!-- html comment -->');
		expect(loaded?.messages[1].content).toContain('A --> B');
	});

	it('should fall back to V1 format for backwards compatibility', async () => {
		const v1Session: ChatSession = {
			id: 'session-v1-legacy',
			title: 'Old V1 Session',
			createdAt: 1690000000000,
			updatedAt: 1690000000000,
			providerId: 'openai',
			modelId: 'gpt-4o',
			messages: [
				{
					id: 'm1',
					role: 'user',
					content: 'Legacy question',
					timestamp: 1690000000000,
					isStreaming: false,
				},
			],
		};

		const v1FileContent = `---
id: session-v1-legacy
title: "Old V1 Session"
---

**👤 You** · 10:00:00 AM

Legacy question

<!-- LUMINA_HISTORY_DATA: ${JSON.stringify(v1Session)} -->
`;

		const filePath = 'Lumina/History/230722_1000 - Old V1 Session.md';
		const file = new TFile();
		file.path = filePath;
		file.name = '230722_1000 - Old V1 Session.md';
		file.extension = 'md';
		file.stat = { ctime: 1690000000000, mtime: 1690000000000, size: v1FileContent.length };
		virtualFiles.set(filePath, { content: v1FileContent, file });

		const loaded = await loadSession(mockApp, 'session-v1-legacy', 'Lumina/History');
		expect(loaded).not.toBeNull();
		expect(loaded?.id).toBe('session-v1-legacy');
		expect(loaded?.title).toBe('Old V1 Session');
		expect(loaded?.messages[0].content).toBe('Legacy question');
	});
});
