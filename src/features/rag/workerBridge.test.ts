import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EmbeddingWorkerBridge } from './workerBridge';

const mockWorkerPoolInit = vi.fn().mockResolvedValue(undefined);
const mockWorkerPoolTerminate = vi.fn();
let mockWorkerPoolReady = true;

const mockWorkerInstance = {
	worker: { postMessage: vi.fn() },
	embedRequests: {
		add: vi.fn((_requestId, resolve) => {
			resolve([[0.1, 0.2]]);
		}),
	},
	parseRequests: { add: vi.fn() },
};

vi.mock('./utils/WorkerPool', () => ({
	WorkerPool: class {
		init = mockWorkerPoolInit;
		terminate = mockWorkerPoolTerminate;
		getNextWorker = vi.fn().mockReturnValue(mockWorkerInstance);
		get ready() { return mockWorkerPoolReady; }
		get activeWorkerCount() { return 2; }
	}
}));

vi.mock('./utils/EmbeddingCacheManager', () => ({
	EmbeddingCacheManager: class {
		init = vi.fn();
		get = vi.fn();
		set = vi.fn();
		trimCacheIfNecessary = vi.fn();
		persistCache = vi.fn().mockResolvedValue(undefined);
	}
}));

vi.mock('./utils/workerCodec', () => ({
	decompressWorkerCode: vi.fn().mockResolvedValue('console.log("worker");')
}));

vi.mock('../../shared/debugLogger', () => ({
	debugLogger: {
		logWarn: vi.fn(),
		logInfo: vi.fn(),
		logError: vi.fn(),
		logSystem: vi.fn(),
	}
}));

vi.mock('../../shared/locales/helpers', () => ({
	t: (key: string) => key
}));

describe('EmbeddingWorkerBridge', () => {
	let bridge: EmbeddingWorkerBridge;
	let createdUrls: string[] = [];
	let revokedUrls: string[] = [];

	beforeEach(() => {
		vi.clearAllMocks();
		mockWorkerPoolReady = true;
		createdUrls = [];
		revokedUrls = [];

		let counter = 0;
		vi.stubGlobal('URL', {
			createObjectURL: vi.fn((_blob: Blob) => {
				const url = `blob:test-url-${++counter}`;
				createdUrls.push(url);
				return url;
			}),
			revokeObjectURL: vi.fn((url: string) => {
				revokedUrls.push(url);
			}),
		});

		bridge = new EmbeddingWorkerBridge();
	});

	afterEach(() => {
		bridge.terminate();
		vi.unstubAllGlobals();
	});

	it('should create a Blob URL on init and pass to workerPool', async () => {
		await bridge.init('test-model', '/mock/cache');

		expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
		expect(mockWorkerPoolInit).toHaveBeenCalledWith(
			expect.any(Number),
			createdUrls[0],
			expect.objectContaining({ modelName: 'test-model', cacheDir: '/mock/cache' }),
			undefined
		);
		expect(bridge.ready).toBe(true);
	});

	it('should revoke Blob URL on terminate', async () => {
		await bridge.init('test-model', '/mock/cache');
		const url = createdUrls[0];

		bridge.terminate();

		expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
		expect(revokedUrls).toContain(url);
		expect(mockWorkerPoolTerminate).toHaveBeenCalled();
		expect(bridge.ready).toBe(false);
	});

	it('should revoke previous Blob URL when reinitialized', async () => {
		await bridge.init('model-1', '/mock/cache');
		const firstUrl = createdUrls[0];

		await bridge.init('model-2', '/mock/cache');
		const secondUrl = createdUrls[1];

		expect(revokedUrls).toContain(firstUrl);
		expect(URL.revokeObjectURL).toHaveBeenCalledWith(firstUrl);
		expect(firstUrl).not.toBe(secondUrl);
	});

	it('should deduplicate concurrent ensureReady calls via reinitPromise', async () => {
		await bridge.init('test-model', '/mock/cache');
		bridge.terminate();

		// Simulate bridge is idle/not ready
		mockWorkerPoolReady = false;

		// Trigger multiple concurrent embed calls while not ready
		let initCallCount = 0;
		mockWorkerPoolInit.mockImplementation(async () => {
			initCallCount++;
			await new Promise(resolve => setTimeout(resolve, 50));
			mockWorkerPoolReady = true;
		});

		const p1 = bridge.embed(['text 1']);
		const p2 = bridge.embed(['text 2']);

		await Promise.all([p1, p2]);

		// workerPool.init should only have been called once despite 2 concurrent requests
		expect(initCallCount).toBe(1);
	});
});
