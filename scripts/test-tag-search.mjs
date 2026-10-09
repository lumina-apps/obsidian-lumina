import { readFileSync } from 'fs';

const CDP_PORT = 9222;

async function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

class CDPClient {
	constructor(wsUrl) {
		this.wsUrl = wsUrl;
		this.ws = null;
		this.msgId = 1;
		this.pending = new Map();
	}

	async connect() {
		this.ws = new WebSocket(this.wsUrl);
		return new Promise((resolve, reject) => {
			this.ws.onopen = () => {
				this.ws.onmessage = (event) => {
					try {
						const data = JSON.parse(event.data);
						if (data.id && this.pending.has(data.id)) {
							const { resolve, reject } = this.pending.get(data.id);
							if (data.error) reject(new Error(data.error.message));
							else resolve(data.result);
							this.pending.delete(data.id);
						}
					} catch (e) {
						console.error('WebSocket msg error:', e);
					}
				};
				resolve();
			};
			this.ws.onerror = reject;
		});
	}

	async send(method, params = {}) {
		if (!this.ws) throw new Error('Not connected');
		const id = this.msgId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.ws.send(JSON.stringify({ id, method, params }));
		});
	}

	async evaluate(expression) {
		const res = await this.send('Runtime.evaluate', {
			expression,
			awaitPromise: true,
			returnByValue: true
		});
		if (res.exceptionDetails) {
			throw new Error('Evaluation Exception: ' + res.exceptionDetails.exception.description);
		}
		return res.result.value;
	}

	disconnect() {
		if (this.ws) {
			this.ws.close();
			this.ws = null;
		}
	}
}

async function runTest() {
	try {
		console.log(`Connecting to Obsidian CDP on port ${CDP_PORT}...`);
		const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
		const targets = await res.json();
		const pageTarget = targets.find(t => t.type === 'page' && t.url.includes('obsidian.md'));
		if (!pageTarget) throw new Error('Could not find Obsidian page target via CDP');
		
		console.log(`Found Obsidian Target: "${pageTarget.title}"`);
		const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
		await client.connect();
		console.log('Connected successfully to Obsidian runtime!\n');

		// 1. Create a note with a tag and check filterParentChunks behavior
		const evalResult = await client.evaluate(`(async () => {
			const lumina = app.plugins.plugins['lumina'];
			if (!lumina.indexer) return { error: 'no indexer' };
			
			const testPath = '__lumina_tag_e2e__.md';
			let file = app.vault.getAbstractFileByPath(testPath);
			if (file) await app.vault.delete(file);
			file = await app.vault.create(testPath, '---\\ntags:\\n  - e2etag\\n---\\n# 테스트 태그 문서\\n여기에는 #testTag가 있습니다.');
			
			// wait for metadata cache to update
			await new Promise(r => setTimeout(r, 1000));
			
			const cache = app.metadataCache.getCache(testPath);
			const obsidianTags = obsidian.getAllTags(cache);
			
			// Let's test the search filter
			const parentChunks = lumina.indexer.indexedParentChunks;
			if(parentChunks.length === 0) return { error: 'no indexed chunks' };
			
			const testChunks = [{ path: testPath, id: 'test_chunk_1' }];
			
			// filter function
			const q = '#e2etag'.trim();
			const isTagQuery = q.startsWith('#');
			const qNormalized = q.toLowerCase();
			const targetTag = qNormalized;
			const targetPrefix = targetTag + '/';
			const pathTagMatchCache = new Map();
			
			const filtered = testChunks.filter((c) => {
				if (!c.path) return false;
				if (pathTagMatchCache.has(c.path)) return pathTagMatchCache.get(c.path);

				const cCache = app.metadataCache.getCache(c.path);
				const tags = cCache ? (obsidian.getAllTags(cCache) ?? []) : [];
				const matched = tags.some((t) => {
					const lower = t.toLowerCase();
					return lower === targetTag || lower.startsWith(targetPrefix);
				});

				pathTagMatchCache.set(c.path, matched);
				return matched;
			});
			
			// also test #testtag
			const q2 = '#testtag';
			const targetTag2 = q2;
			const targetPrefix2 = q2 + '/';
			const pathTagMatchCache2 = new Map();
			const filtered2 = testChunks.filter((c) => {
				const cCache = app.metadataCache.getCache(c.path);
				const tags = cCache ? (obsidian.getAllTags(cCache) ?? []) : [];
				return tags.some(t => t.toLowerCase() === targetTag2 || t.toLowerCase().startsWith(targetPrefix2));
			});
			
			// Cleanup
			await app.vault.delete(file);
			
			return {
				cacheResult: cache,
				obsidianTags: obsidianTags,
				filteredForE2ETag: filtered.length,
				filteredForTestTag: filtered2.length
			};
		})()`);
		
		console.log(JSON.stringify(evalResult, null, 2));

		client.disconnect();
	} catch (e) {
		console.error('E2E Test Failed:', e);
		process.exit(1);
	}
}

runTest();
