import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EmbeddingStore } from './embeddingStore';

describe('EmbeddingStore', () => {
	let store: EmbeddingStore;
	let mockDb: any;
	let mockStore: any;
	let mockTransaction: any;

	beforeEach(() => {
		mockStore = {
			put: vi.fn(),
			get: vi.fn().mockReturnValue({ onsuccess: null, onerror: null, result: null }),
			delete: vi.fn()
		};

		mockTransaction = {
			objectStore: vi.fn().mockReturnValue(mockStore),
			oncomplete: null,
			onerror: null
		};

		mockDb = {
			objectStoreNames: {
				contains: vi.fn().mockReturnValue(false)
			},
			createObjectStore: vi.fn(),
			transaction: vi.fn().mockReturnValue(mockTransaction),
			close: vi.fn()
		};

		const mockRequest = {
			onupgradeneeded: null as any,
			onsuccess: null as any,
			onerror: null as any,
			result: mockDb,
			error: new Error('mock error')
		};

		vi.stubGlobal('indexedDB', {
			open: vi.fn().mockImplementation(() => {
				// We need to defer execution to allow test to attach handlers
				setTimeout(() => {
					if (mockRequest.onupgradeneeded) mockRequest.onupgradeneeded();
					if (mockRequest.onsuccess) mockRequest.onsuccess();
				}, 0);
				return mockRequest;
			})
		});

		store = new EmbeddingStore();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		vi.clearAllMocks();
	});

	describe('init', () => {
		it('should create object store on upgrade', async () => {
			await store.init('test');
			expect(mockDb.createObjectStore).toHaveBeenCalledWith('embeddings', { keyPath: 'id' });
		});

		it('should use projectId for dbName if provided', async () => {
			await store.init('test', 'proj-123');
			expect(indexedDB.open).toHaveBeenCalledWith('lumina-embeddings-proj-123', 1);
		});
	});

	describe('storeEmbeddings', () => {
		it('should store embeddings in batches', async () => {
			await store.init('test');
			
			// Override transaction so we can trigger oncomplete
			mockDb.transaction.mockImplementation(() => {
				setTimeout(() => {
					if (mockTransaction.oncomplete) mockTransaction.oncomplete();
				}, 0);
				return mockTransaction;
			});

			const chunks = [
				{ id: '1', embedding: [0.1, 0.2] },
				{ id: '2', embedding: new Float32Array([0.3, 0.4]) }
			];

			await store.storeEmbeddings(chunks);
			expect(mockStore.put).toHaveBeenCalledTimes(2);
			
			// Verify it handles both Array and Float32Array
			expect(mockStore.put.mock.calls[0][0].dim).toBe(2);
			expect(mockStore.put.mock.calls[1][0].dim).toBe(2);
		});

		it('should early return if chunks list is empty', async () => {
			await store.init('test');
			await store.storeEmbeddings([]);
			expect(mockDb.transaction).not.toHaveBeenCalled();
		});
	});

	describe('loadEmbeddings', () => {
		it('should load embeddings from db', async () => {
			await store.init('test');
			
			mockDb.transaction.mockImplementation(() => {
				return mockTransaction;
			});

			const mockReq = {
				onsuccess: null as any,
				result: {
					id: '1',
					modelName: 'test',
					embedding: new Float32Array([0.1, 0.2]).buffer,
					dim: 2
				}
			};

			mockStore.get.mockImplementation(() => {
				setTimeout(() => {
					if (mockReq.onsuccess) mockReq.onsuccess();
				}, 0);
				return mockReq;
			});

			const chunks: { id: string; embedding?: Float32Array | number[] }[] = [{ id: '1' }];
			await store.loadEmbeddings(chunks);

			expect(chunks[0].embedding).toBeInstanceOf(Float32Array);
			expect(chunks[0].embedding![0]).toBeCloseTo(0.1, 5);
		});

		it('should ignore embeddings from wrong model', async () => {
			await store.init('test');
			
			mockDb.transaction.mockImplementation(() => mockTransaction);

			const mockReq = {
				onsuccess: null as any,
				result: {
					id: '1',
					modelName: 'wrong-model', // wrong model
					embedding: new Float32Array([0.1, 0.2]).buffer,
					dim: 2
				}
			};

			mockStore.get.mockImplementation(() => {
				setTimeout(() => mockReq.onsuccess && mockReq.onsuccess(), 0);
				return mockReq;
			});

			const chunks: { id: string; embedding?: Float32Array | number[] }[] = [{ id: '1' }];
			await store.loadEmbeddings(chunks);

			expect(chunks[0].embedding).toBeUndefined();
		});

		it('should reject if load embedding fails', async () => {
			await store.init('test');
			
			mockDb.transaction.mockImplementation(() => mockTransaction);

			const mockReq = {
				onsuccess: null as any,
				onerror: null as any,
				error: new Error('load err'),
				result: null
			};

			mockStore.get.mockImplementation(() => {
				setTimeout(() => mockReq.onerror && mockReq.onerror(), 0);
				return mockReq;
			});

			await expect(store.loadEmbeddings([{ id: 'err-id' }])).rejects.toThrow('loadEmbedding failed for err-id: load err');
		});

		it('should throw if not initialized and no modelName', async () => {
			await expect(store.loadEmbeddings([{id: '1'}])).rejects.toThrow('EmbeddingStore not initialized');
		});
	});

	describe('deleteEmbeddings', () => {
		it('should delete embeddings by ids', async () => {
			mockStore.delete = vi.fn();
			await store.init('test');
			
			mockDb.transaction.mockImplementation(() => {
				setTimeout(() => mockTransaction.oncomplete && mockTransaction.oncomplete(), 0);
				return mockTransaction;
			});

			await store.deleteEmbeddings(['1', '2']);
			expect(mockStore.delete).toHaveBeenCalledWith('1');
			expect(mockStore.delete).toHaveBeenCalledWith('2');
		});

		it('should early return if ids list is empty', async () => {
			await store.init('test');
			await store.deleteEmbeddings([]);
			expect(mockDb.transaction).not.toHaveBeenCalled();
		});

		it('should reject if delete fails', async () => {
			await store.init('test');
			mockDb.transaction.mockImplementation(() => {
				setTimeout(() => mockTransaction.onerror && mockTransaction.onerror(), 0);
				return mockTransaction;
			});

			await expect(store.deleteEmbeddings(['1'])).rejects.toThrow('deleteEmbeddings failed');
		});
		
		it('should throw if not initialized', async () => {
			await expect(store.deleteEmbeddings(['1'])).rejects.toThrow('EmbeddingStore not initialized');
		});
	});

	describe('clear and close', () => {
		it('should close connection properly', async () => {
			await store.init('test');
			store.close();
			expect(mockDb.close).toHaveBeenCalled();
		});

		it('should close without error if db is null', () => {
			expect(() => store.close()).not.toThrow();
		});

		it('should clear by deleting database and re-initializing', async () => {
			await store.init('test');
			
			const deleteReq = {
				onsuccess: null as any,
				onerror: null as any,
				onblocked: null as any
			};
			
			indexedDB.deleteDatabase = vi.fn().mockImplementation(() => {
				setTimeout(() => deleteReq.onsuccess && deleteReq.onsuccess(), 0);
				return deleteReq;
			});

			const initSpy = vi.spyOn(store, 'init');
			
			await store.clear();
			
			expect(mockDb.close).toHaveBeenCalled();
			expect(indexedDB.deleteDatabase).toHaveBeenCalledWith('lumina-embeddings');
			expect(initSpy).toHaveBeenCalledWith('test');
		});

		it('should handle clear error', async () => {
			await store.init('test');
			
			const deleteReq = {
				onsuccess: null as any,
				onerror: null as any,
				onblocked: null as any,
				error: new Error('del err')
			};
			
			indexedDB.deleteDatabase = vi.fn().mockImplementation(() => {
				setTimeout(() => deleteReq.onerror && deleteReq.onerror(), 0);
				return deleteReq;
			});

			await expect(store.clear()).rejects.toThrow('IndexedDB delete failed: del err');
		});
		
		it('should log warning when clear is blocked', async () => {
			await store.init('test');
			
			const deleteReq = {
				onsuccess: null as any,
				onerror: null as any,
				onblocked: null as any
			};
			
			indexedDB.deleteDatabase = vi.fn().mockImplementation(() => {
				setTimeout(() => {
					if (deleteReq.onblocked) deleteReq.onblocked();
					if (deleteReq.onsuccess) deleteReq.onsuccess();
				}, 0);
				return deleteReq;
			});

			const warnSpy = vi.spyOn(console, 'warn');
			await store.clear();
			expect(warnSpy).toHaveBeenCalledWith('IndexedDB delete blocked: waiting for other transactions to finish');
		});
	});
});
