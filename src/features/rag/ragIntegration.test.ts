import { describe, it, expect, vi, beforeEach } from 'vitest';
import { VaultIndexer } from './indexer';
import { searchVault } from './search';
import { App, TFile } from 'obsidian';
import { EmbeddingStore } from './embeddingStore';

class FakeEmbeddingStore {
	private store = new Map<string, { id: string; modelName: string; embedding: number[]; dim: number }>();
	private modelName: string = '';
	private projectId: string = '';

	async init(modelName: string, projectId?: string) {
		this.modelName = modelName;
		this.projectId = projectId || 'default';
	}

	async storeEmbeddings(chunks: Array<{ id: string; embedding?: number[] | Float32Array }>) {
		for (const chunk of chunks) {
			if (chunk.embedding) {
				const embeddingArr = Array.isArray(chunk.embedding)
					? chunk.embedding
					: Array.from(chunk.embedding);
				this.store.set(chunk.id, {
					id: chunk.id,
					modelName: this.modelName,
					embedding: embeddingArr,
					dim: embeddingArr.length,
				});
			}
		}
	}

	async loadEmbeddings(chunkIds: string[]) {
		const result = new Map<string, number[]>();
		for (const id of chunkIds) {
			const record = this.store.get(id);
			if (record) {
				result.set(id, record.embedding);
			}
		}
		return result;
	}

	async deleteEmbeddings(chunkIds: string[]) {
		for (const id of chunkIds) {
			this.store.delete(id);
		}
	}

	async clear() {
		this.store.clear();
	}

	close() {}
}

describe('RAG Pipeline Integration', () => {
	let fakeFiles: Map<string, string>;
	let fakeMtimes: Map<string, number>;
	let mockApp: any;
	let mockEmbedFn: any;
	let mockParseBinaryFn: any;
	let mockSettings: any;
	let fakeEmbeddingStore: FakeEmbeddingStore;

	beforeEach(() => {
		fakeFiles = new Map();
		fakeMtimes = new Map();

		// 가상 파일 시스템 셋업
		fakeFiles.set('test_vault/note1.md', '# Hello World\nThis is the first note containing important project info.');
		fakeMtimes.set('test_vault/note1.md', 1000);

		fakeFiles.set('test_vault/note2.md', '# RAG Integration\nLet us verify that indexing works correctly with embedding stores.');
		fakeMtimes.set('test_vault/note2.md', 1000);

		mockEmbedFn = vi.fn().mockImplementation(async (texts: string[]) => {
			// 각 텍스트에 대해 길이가 3인 더미 임베딩 리턴
			return texts.map(text => {
				const charCodeSum = text.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0);
				const factor = charCodeSum % 100;
				return [factor * 0.1, factor * 0.2, factor * 0.3];
			});
		});

		mockParseBinaryFn = vi.fn().mockResolvedValue('');

		mockSettings = {
			parentChunkSize: 1000,
			parentChunkOverlap: 200,
			childChunkSize: 200,
			childChunkOverlap: 40,
			syncMode: 'watch',
			maxFileSizeMB: 10,
			excludedFolders: [],
		};

		fakeEmbeddingStore = new FakeEmbeddingStore();

		// Obsidian App Mock
		const mockVault = {
			configDir: '.obsidian',
			getFiles: () => {
				const files: TFile[] = [];
				for (const [path] of fakeFiles.entries()) {
					if (path.includes('.obsidian')) continue;
					const ext = path.split('.').pop() || '';
					files.push({
						path,
						name: path.split('/').pop() || '',
						extension: ext,
						vault: mockVault,
						stat: {
							size: fakeFiles.get(path)?.length || 0,
							mtime: fakeMtimes.get(path) || 1000,
						},
					} as unknown as TFile);
				}
				return files;
			},
			getMarkdownFiles: () => {
				const files: TFile[] = [];
				for (const [path] of fakeFiles.entries()) {
					if (path.endsWith('.md') && !path.includes('.obsidian')) {
						files.push({
							path,
							name: path.split('/').pop() || '',
							extension: 'md',
							vault: mockVault,
							stat: {
								size: fakeFiles.get(path)?.length || 0,
								mtime: fakeMtimes.get(path) || 1000,
							},
						} as unknown as TFile);
					}
				}
				return files;
			},
			read: async (file: TFile) => {
				return fakeFiles.get(file.path) || '';
			},
			adapter: {
				exists: async (path: string) => {
					return fakeFiles.has(path);
				},
				read: async (path: string) => {
					if (!fakeFiles.has(path)) throw new Error(`File not found: ${path}`);
					return fakeFiles.get(path)!;
				},
				write: async (path: string, content: string) => {
					fakeFiles.set(path, content);
				},
				mkdir: async (path: string) => {},
			},
		};

		mockApp = {
			vault: mockVault,
		};
	});

	it('should run indexVault, persist index state, and retrieve results via hybridSearch', async () => {
		const indexer = new VaultIndexer({
			app: mockApp as unknown as App,
			embedFn: mockEmbedFn,
			parseBinaryFn: mockParseBinaryFn,
			settings: mockSettings,
			includedPaths: [],
			excludedPaths: [],
			chatHistoryPath: 'chat_history',
			modelName: 'test-embedding-model',
			projectId: 'test_project',
			embeddingStore: fakeEmbeddingStore as unknown as EmbeddingStore,
		});

		// 1. Orama 초기화 및 전체 인덱싱 수행
		await indexer.initOramaStore();
		await indexer.indexVault();

		// 인덱스 생성 확인
		expect(indexer.indexedParentChunks.length).toBe(2);
		expect(indexer.indexedChildChunks.length).toBe(2);
		expect(indexer.indexedFileCount).toBe(2);
		expect(mockEmbedFn).toHaveBeenCalled();

		// 2. 디스크에 index.json이 저장되었는지 가상 파일 시스템 검증
		const persistedPath = '.obsidian/plugins/lumina/storage/index_test_project.json';
		expect(fakeFiles.has(persistedPath)).toBe(true);

		const rawPersisted = fakeFiles.get(persistedPath)!;
		const parsed = JSON.parse(rawPersisted);
		expect(parsed.modelName).toBe('test-embedding-model');
		expect(parsed.chunks.length).toBe(2);

		// 3. 하이브리드 검색 실행 검증
		const searchResults = await searchVault(
			'RAG Integration',
			indexer.indexedParentChunks,
			indexer.oramaDb,
			mockEmbedFn,
			5,
			0.1, // 코사인 유사도 하한 임계값을 낮춰 결과 검증이 잘 되도록 설정
			0.5,
		);

		expect(searchResults.length).toBeGreaterThan(0);
		// 'RAG Integration' 관련 컨텐츠가 가장 상위에 오는지 확인
		expect(searchResults[0].chunk.text).toContain('RAG Integration');

		// 4. 새 파일 추가 시 증분 업데이트 검증
		fakeFiles.set('test_vault/note3.md', '# New Feature\nThis is a newly added feature note for verification.');
		fakeMtimes.set('test_vault/note3.md', 1000);

		// indexer의 updateIndex 호출
		await indexer.updateIndex();

		expect(indexer.indexedFileCount).toBe(3);
		expect(indexer.indexedParentChunks.length).toBe(3);
	});
});
