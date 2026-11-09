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
		const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json`);
		const targets = await res.json();
		const pageTarget = targets.find(t => t.type === 'page' && t.url.includes('obsidian.md'));
		const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
		await client.connect();

		const evalResult = await client.evaluate(`(async () => {
			const lumina = app.plugins.plugins['lumina'];
			if (!lumina.indexer) return { error: 'no indexer' };
			
			const testPath = '__lumina_tag_e2e__.md';
			let file = app.vault.getAbstractFileByPath(testPath);
			if (file) await app.vault.delete(file);
			file = await app.vault.create(testPath, '---\\ntags:\\n  - e2etag\\n---\\n# 테스트 태그 문서\\n여기에는 #testTag가 있습니다.');
			
			try {
				// wait for metadata cache to update
				await new Promise(r => setTimeout(r, 1000));
				
				const chunks = lumina.indexer.indexedParentChunks || [];
				const q = '#e2etag';
				const targetTag = q.toLowerCase();
				const targetPrefix = targetTag + '/';
				
				const filtered = chunks.filter(c => {
					const cache = app.metadataCache.getCache(c.path);
					if (!cache) return false;
					const tags = (obsidian && typeof obsidian.getAllTags === 'function')
						? (obsidian.getAllTags(cache) ?? [])
						: [...(cache.tags?.map(t => t.tag) || []), ...(Array.isArray(cache.frontmatter?.tags) ? cache.frontmatter.tags.map(t => '#' + t) : [])];
					
					return tags.some(t => t.toLowerCase() === targetTag || t.toLowerCase().startsWith(targetPrefix));
				});
				
				return { totalChunks: chunks.length, filteredMatches: filtered.length, matchedPaths: filtered.map(f => f.path) };
			} finally {
				const cleanupFile = app.vault.getAbstractFileByPath(testPath);
				if (cleanupFile) await app.vault.delete(cleanupFile);
			}
		})()`);
		
		console.log(JSON.stringify(evalResult, null, 2));

		client.disconnect();
	} catch (e) {
		console.error('E2E Test Failed:', e);
		process.exit(1);
	}
}

runTest();
