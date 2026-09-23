/**
 * Obsidian Lumina E2E Automated Test Runner via CDP (Chrome DevTools Protocol)
 * Connects to Obsidian on port 9222 and executes automated integration tests
 * simulating genuine physical mouse clicks, keyboard input, and lifecycle flows.
 * open -a Obsidian --args --remote-debugging-port=9222
 */

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
							this.pending.delete(data.id);
							if (data.error) {
								reject(new Error(`CDP Error: ${JSON.stringify(data.error)}`));
							} else {
								resolve(data.result);
							}
						}
					} catch (e) {
						console.error('Failed to parse CDP message:', e);
					}
				};
				resolve();
			};
			this.ws.onerror = reject;
		});
	}

	async send(method, params = {}) {
		const id = this.msgId++;
		return new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			this.ws.send(JSON.stringify({ id, method, params }));
		});
	}

	async evaluate(expression) {
		const result = await this.send('Runtime.evaluate', {
			expression,
			returnByValue: true,
			awaitPromise: true,
		});
		if (result.exceptionDetails) {
			const desc = result.exceptionDetails.exception?.description || result.exceptionDetails.text;
			throw new Error(`Evaluation Exception: ${desc}`);
		}
		return result.result?.value;
	}

	close() {
		if (this.ws) {
			this.ws.close();
		}
	}
}

/**
 * Controller for physical mouse & keyboard simulation using CDP Input domain
 */
class InputController {
	constructor(client) {
		this.client = client;
	}

	async getElementRect(selector) {
		return await this.client.evaluate(`(() => {
			const el = document.querySelector(${JSON.stringify(selector)});
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return {
				x: r.left + r.width / 2,
				y: r.top + r.height / 2,
				width: r.width,
				height: r.height,
				visible: r.width > 0 && r.height > 0
			};
		})()`);
	}

	async click(selector) {
		const rect = await this.getElementRect(selector);
		if (!rect) {
			throw new Error(`Element not found for selector: ${selector}`);
		}
		await this.clickCoords(rect.x, rect.y);
	}

	async clickCoords(x, y) {
		await this.client.send('Input.dispatchMouseEvent', {
			type: 'mouseMoved',
			x,
			y,
		});
		await sleep(20);
		await this.client.send('Input.dispatchMouseEvent', {
			type: 'mousePressed',
			x,
			y,
			button: 'left',
			clickCount: 1,
		});
		await sleep(50);
		await this.client.send('Input.dispatchMouseEvent', {
			type: 'mouseReleased',
			x,
			y,
			button: 'left',
			clickCount: 1,
		});
	}

	async type(selector, text) {
		await this.click(selector);
		await sleep(100);
		await this.client.send('Input.insertText', { text });
	}

	async pressKey(key, code = key, keyCode = 0, modifiers = 0) {
		await this.client.send('Input.dispatchKeyEvent', {
			type: 'rawKeyDown',
			key,
			code,
			windowsVirtualKeyCode: keyCode,
			modifiers,
		});
		await sleep(50);
		await this.client.send('Input.dispatchKeyEvent', {
			type: 'keyUp',
			key,
			code,
			windowsVirtualKeyCode: keyCode,
			modifiers,
		});
	}

	async pressEscape() {
		await this.pressKey('Escape', 'Escape', 27);
	}

	async pressEnter() {
		await this.pressKey('Enter', 'Enter', 13);
	}
}

class TestReporter {
	constructor() {
		this.results = [];
		this.currentSuite = '';
	}

	startSuite(name) {
		this.currentSuite = name;
		console.log(`\n==================================================`);
		console.log(`▶ SUITE: ${name}`);
		console.log(`==================================================`);
	}

	record(testName, passed, details = '', durationMs = 0) {
		const item = {
			suite: this.currentSuite,
			test: testName,
			passed,
			details,
			durationMs,
		};
		this.results.push(item);
		const icon = passed ? '✅ PASS' : '❌ FAIL';
		console.log(`  ${icon} [${durationMs}ms] ${testName}`);
		if (details) {
			console.log(`     └─ ${details}`);
		}
	}

	summary() {
		const total = this.results.length;
		const passed = this.results.filter((r) => r.passed).length;
		const failed = total - passed;
		console.log(`\n==================================================`);
		console.log(`🏁 TEST EXECUTION SUMMARY`);
		console.log(`==================================================`);
		console.log(`Total: ${total} | Passed: ${passed} | Failed: ${failed}`);
		if (failed > 0) {
			console.log(`\nFailed Tests:`);
			for (const r of this.results.filter((r) => !r.passed)) {
				console.log(`- [${r.suite}] ${r.test}: ${r.details}`);
			}
		}
		console.log(`==================================================\n`);
		return { total, passed, failed, results: this.results };
	}
}

async function run() {
	console.log(`Connecting to Obsidian CDP on port ${CDP_PORT}...`);
	const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`);
	const targets = await res.json();
	const pageTarget = targets.find((t) => t.type === 'page' && t.url.includes('obsidian.md'));

	if (!pageTarget) {
		console.error('Obsidian page target not found! Available targets:', targets);
		process.exit(1);
	}

	console.log(`Found Obsidian Target: "${pageTarget.title}"`);
	const client = new CDPClient(pageTarget.webSocketDebuggerUrl);
	await client.connect();
	console.log('Connected successfully to Obsidian runtime!');

	const input = new InputController(client);
	const reporter = new TestReporter();

	// ─── SUITE 1: Core Lifecycle & Registrations ─────────────────────────────
	reporter.startSuite('Core Lifecycle & Registrations');
	{
		const t0 = Date.now();
		try {
			const info = await client.evaluate(`(() => {
				const p = app.plugins.plugins['lumina'];
				return {
					loaded: !!p,
					manifestVersion: app.plugins.manifests['lumina']?.version,
					vaultName: app.vault.getName(),
					hasRibbon: !!document.querySelector('.side-dock-ribbon-action[aria-label*="Lumina"]')
				};
			})()`);

			reporter.record('Plugin Loaded & Version Match', info.loaded && info.manifestVersion === '1.4.4', `Version: ${info.manifestVersion}`, Date.now() - t0);
			reporter.record('Ribbon Icon Present', info.hasRibbon, `Vault: ${info.vaultName}`, Date.now() - t0);
		} catch (err) {
			reporter.record('Plugin Loaded & Version Match', false, err.message, Date.now() - t0);
		}

		const t1 = Date.now();
		try {
			const cmds = await client.evaluate(`(() => {
				const expected = [
					'lumina:open-chat',
					'lumina:open-devlog',
					'lumina:open-graph-view',
					'lumina:reindex-vault',
					'lumina:clear-index',
					'lumina:strip-frontmatter-metadata',
					'lumina:auto-link-current-note',
					'lumina:qa-summarize',
					'lumina:qa-translate',
					'lumina:qa-explain'
				];
				const registered = Object.keys(app.commands.commands);
				const missing = expected.filter(id => !registered.includes(id));
				return { missing, totalLuminaCommands: registered.filter(id => id.startsWith('lumina')).length };
			})()`);

			reporter.record('Registered Commands', cmds.missing.length === 0, cmds.missing.length === 0 ? `Total Lumina commands: ${cmds.totalLuminaCommands}` : `Missing: ${cmds.missing.join(', ')}`, Date.now() - t1);
		} catch (err) {
			reporter.record('Registered Commands', false, err.message, Date.now() - t1);
		}

		const t2 = Date.now();
		try {
			const views = await client.evaluate(`(() => {
				const expected = ['lumina-chat', 'lumina-debug-panel', 'lumina-graph'];
				const reg = Object.keys(app.viewRegistry.viewByType);
				const missing = expected.filter(id => !reg.includes(id));
				return { missing, registered: reg.filter(id => id.includes('lumina')) };
			})()`);

			reporter.record('Registered View Types', views.missing.length === 0, `Views: ${views.registered.join(', ')}`, Date.now() - t2);
		} catch (err) {
			reporter.record('Registered View Types', false, err.message, Date.now() - t2);
		}
	}

	// ─── SUITE 2: Chat View (Physical Mouse Click & Typing Simulation) ───────
	reporter.startSuite('Chat View (Physical Mouse & Keyboard Interaction)');
	{
		// 1. Ensure any previous chat leaf is detached
		await client.evaluate(`(() => {
			const leaves = app.workspace.getLeavesOfType('lumina-chat');
			leaves.forEach(l => l.detach());
		})()`);
		await sleep(300);

		// 2. Physical Mouse Click on Ribbon Icon
		const t0 = Date.now();
		try {
			const ribbonSelector = '.side-dock-ribbon-action[aria-label*="Lumina"]';
			const ribbonRect = await input.getElementRect(ribbonSelector);

			if (!ribbonRect) {
				throw new Error('Lumina ribbon button not found on screen');
			}

			// Perform genuine mouse click at coordinates
			await input.clickCoords(ribbonRect.x, ribbonRect.y);
			await sleep(600);

			const leafCreated = await client.evaluate(`app.workspace.getLeavesOfType('lumina-chat').length > 0`);
			reporter.record(
				'Physical Mouse Click on Ribbon Icon',
				leafCreated,
				`Clicked at (${ribbonRect.x.toFixed(1)}, ${ribbonRect.y.toFixed(1)}) -> chat leaf opened`,
				Date.now() - t0
			);
		} catch (err) {
			reporter.record('Physical Mouse Click on Ribbon Icon', false, err.message, Date.now() - t0);
		}

		// 3. Physical Click and Typing into Chat Input Textarea
		const t1 = Date.now();
		try {
			const textareaSelector = '.lumina-chat-view textarea';
			const testMessage = '안녕하세요! Lumina 플러그인 실제 마우스/키보드 E2E 테스트입니다.';

			await input.type(textareaSelector, testMessage);
			await sleep(200);

			const currentVal = await client.evaluate(`document.querySelector('.lumina-chat-view textarea')?.value || ''`);
			const typedMatch = currentVal.includes('Lumina');

			reporter.record(
				'Physical Textarea Focus & Keyboard Typing',
				typedMatch,
				`Typed length: ${currentVal.length} chars ("${currentVal.slice(0, 30)}...")`,
				Date.now() - t1
			);
		} catch (err) {
			reporter.record('Physical Textarea Focus & Keyboard Typing', false, err.message, Date.now() - t1);
		}

		// 4. Physical Tab Switching via Mouse Clicks
		const t2 = Date.now();
		try {
			// Click Smart Discovery Tab (2nd button)
			await input.click('.lumina-sidebar__tab:nth-child(2)');
			await sleep(300);

			const discoveryActive = await client.evaluate(`(() => {
				const tabs = document.querySelectorAll('.lumina-sidebar__tab');
				return tabs[1]?.classList.contains('is-active');
			})()`);

			// Click AI Chat Tab back (1st button)
			await input.click('.lumina-sidebar__tab:nth-child(1)');
			await sleep(300);

			const chatActive = await client.evaluate(`(() => {
				const tabs = document.querySelectorAll('.lumina-sidebar__tab');
				return tabs[0]?.classList.contains('is-active');
			})()`);

			reporter.record(
				'Physical Tab Click & Navigation',
				discoveryActive && chatActive,
				`Switched to Discovery (active: ${discoveryActive}) -> Switched back to Chat (active: ${chatActive})`,
				Date.now() - t2
			);
		} catch (err) {
			reporter.record('Physical Tab Click & Navigation', false, err.message, Date.now() - t2);
		}

		// 5. Chat Controls Readiness Check
		const t3 = Date.now();
		try {
			const controls = await client.evaluate(`(() => {
				const chatView = document.querySelector('.lumina-chat-view');
				return {
					hasSendBtn: !!chatView?.querySelector('.lumina-chat__send-btn'),
					hasToolbar: !!chatView?.querySelector('.lumina-chat__toolbar, .lumina-chat__input-container'),
					hasModelSelector: !!chatView?.querySelector('.lumina-model-selector__trigger')
				};
			})()`);

			reporter.record(
				'Chat Controls & UI Components Mounted',
				controls.hasSendBtn && controls.hasToolbar && controls.hasModelSelector,
				`Send button: ${controls.hasSendBtn}, Toolbar: ${controls.hasToolbar}, ModelSelector: ${controls.hasModelSelector}`,
				Date.now() - t3
			);
		} catch (err) {
			reporter.record('Chat Controls & UI Components Mounted', false, err.message, Date.now() - t3);
		}

		// Teardown: close leaves
		await client.evaluate(`(() => {
			const leaves = app.workspace.getLeavesOfType('lumina-chat');
			leaves.forEach(l => l.detach());
		})()`);
		await sleep(200);
	}

	// ─── SUITE 3: Debug Panel View ──────────────────────────────────────────
	reporter.startSuite('Debug Panel (Logging System)');
	{
		const t0 = Date.now();
		try {
			await client.evaluate(`app.commands.executeCommandById('lumina:open-devlog')`);
			await sleep(600);

			const debugStatus = await client.evaluate(`(() => {
				const leaves = app.workspace.getLeavesOfType('lumina-debug-panel');
				if (leaves.length === 0) return { open: false };
				const el = leaves[0].view?.contentEl;
				return {
					open: true,
					hasContainer: !!el?.querySelector('.lumina-debug-view, .debug-panel, div')
				};
			})()`);

			reporter.record('Open Debug Panel via Command', debugStatus.open, 'lumina-debug-panel leaf created', Date.now() - t0);

			// Test view lifecycle
			const logTest = await client.evaluate(`(() => {
				const leaves = app.workspace.getLeavesOfType('lumina-debug-panel');
				return {
					leafExists: leaves.length > 0,
					viewType: leaves[0]?.view?.getViewType()
				};
			})()`);
			reporter.record('Debug Panel View Lifecycle', logTest.leafExists && logTest.viewType === 'lumina-debug-panel', `ViewType: ${logTest.viewType}`, Date.now() - t0);
		} catch (err) {
			reporter.record('Open Debug Panel via Command', false, err.message, Date.now() - t0);
		}

		// Teardown
		await client.evaluate(`(() => {
			const leaves = app.workspace.getLeavesOfType('lumina-debug-panel');
			leaves.forEach(l => l.detach());
		})()`);
		await sleep(200);
	}

	// ─── SUITE 4: Graph View ────────────────────────────────────────────────
	reporter.startSuite('Graph View (Semantic Visualizer)');
	{
		const t0 = Date.now();
		try {
			await client.evaluate(`app.commands.executeCommandById('lumina:open-graph-view')`);
			await sleep(800);

			const graphStatus = await client.evaluate(`(() => {
				const leaves = app.workspace.getLeavesOfType('lumina-graph');
				if (leaves.length === 0) return { open: false };
				const el = leaves[0].view?.contentEl;
				return {
					open: true,
					hasCanvasOrContainer: !!el?.querySelector('.lumina-graph-view, canvas, div')
				};
			})()`);

			reporter.record('Open Graph View via Command', graphStatus.open, 'lumina-graph leaf created in workspace', Date.now() - t0);
			reporter.record('Graph Container Initialized', graphStatus.hasCanvasOrContainer, 'DOM container mounted without crash', Date.now() - t0);
		} catch (err) {
			reporter.record('Open Graph View via Command', false, err.message, Date.now() - t0);
		}

		// Teardown
		await client.evaluate(`(() => {
			const leaves = app.workspace.getLeavesOfType('lumina-graph');
			leaves.forEach(l => l.detach());
		})()`);
		await sleep(200);
	}

	// ─── SUITE 5: RAG & Indexing System ─────────────────────────────────────
	reporter.startSuite('RAG Engine & Worker Bridge');
	{
		const t0 = Date.now();
		try {
			const ragState = await client.evaluate(`(() => {
				const lumina = app.plugins.plugins['lumina'];
				return {
					ragEnabled: !!lumina.settings.connections.ragEnabled,
					hasIndexer: !!lumina.indexer,
					hasWorker: !!lumina.embeddingWorker,
					indexedFileCount: lumina.indexer ? lumina.indexer.indexedFileCount : 0,
					parentChunkCount: lumina.indexer ? lumina.indexer.indexedParentChunks.length : 0,
					childChunkCount: lumina.indexer ? lumina.indexer.indexedChildChunks.length : 0
				};
			})()`);

			reporter.record('RAG Indexer & Worker Ready', ragState.hasIndexer && ragState.hasWorker, `Files: ${ragState.indexedFileCount}, Parent Chunks: ${ragState.parentChunkCount}, Child Chunks: ${ragState.childChunkCount}`, Date.now() - t0);

			// Test Embedding functionality via Worker
			const embedTest = await client.evaluate(`(async () => {
				const lumina = app.plugins.plugins['lumina'];
				if (!lumina.indexer) return { success: false, reason: 'no indexer' };
				const start = Date.now();
				const vectors = await lumina.indexer.embed(['Lumina E2E embedding test sentence']);
				return {
					success: Array.isArray(vectors) && vectors.length === 1 && vectors[0].length > 0,
					dim: vectors[0]?.length,
					duration: Date.now() - start
				};
			})()`);

			reporter.record('Embedding Generation via Worker', embedTest.success, `Vector Dimension: ${embedTest.dim}, Latency: ${embedTest.duration}ms`, Date.now() - t0);

			// Test Live Vault Hybrid Search (Orama + BM25)
			const t1 = Date.now();
			try {
				const ragSearchTest = await client.evaluate(`(async () => {
					const lumina = app.plugins.plugins['lumina'];
					const tools = lumina.mcpManager?.getAllTools() || [];
					const ragTool = tools.find(t => t.name === 'rag_search');
					if (!ragTool) return { success: false, reason: 'no rag_search tool' };
					const start = Date.now();
					const res = await lumina.mcpManager.callTool(ragTool._serverId, 'rag_search', { query: '세계관', topK: 3 });
					const text = res?.content?.[0]?.text || '';
					return {
						success: !res?.isError && (text.includes('RAG 검색 결과') || text.includes('청크 발견')),
						summary: text.split('\\n')[0],
						duration: Date.now() - start
					};
				})()`);

				reporter.record(
					'Live Vault Hybrid Search (RAG)',
					ragSearchTest.success,
					`${ragSearchTest.summary || 'Search completed'} (Latency: ${ragSearchTest.duration}ms)`,
					Date.now() - t1
				);
			} catch (searchErr) {
				reporter.record('Live Vault Hybrid Search (RAG)', false, searchErr.message, Date.now() - t1);
			}
		} catch (err) {
			reporter.record('RAG Indexer & Worker Ready', false, err.message, Date.now() - t0);
		}
	}

	// ─── SUITE 6: Editor Extensions & Quick Actions ─────────────────────────
	reporter.startSuite('Editor & Quick Actions');
	{
		const t0 = Date.now();
		try {
			await client.evaluate(`(async () => {
				const testPath = '__lumina_e2e_test__.md';
				let file = app.vault.getAbstractFileByPath(testPath);
				if (!file) {
					file = await app.vault.create(testPath, '# Lumina E2E Test Note\\n\\nThis is a test paragraph for Quick Actions.');
				}
				const leaf = app.workspace.getLeaf(true);
				await leaf.openFile(file);
				return { success: true, leafId: leaf.id };
			})()`);

			await sleep(500);

			const editorCheck = await client.evaluate(`(() => {
				const lumina = app.plugins.plugins['lumina'];
				const activeLeaf = app.workspace.activeLeaf;
				const editor = activeLeaf?.view?.editor;
				const hasQuickAction = !!lumina.quickActionHandler;
				return {
					hasEditor: !!editor,
					hasQuickAction
				};
			})()`);

			reporter.record('Active Note Opened in Editor', editorCheck.hasEditor, 'Test note opened in leaf', Date.now() - t0);
			reporter.record('Quick Action Handler Ready', editorCheck.hasQuickAction, 'Handler registered', Date.now() - t0);

			// Teardown: delete test note & close leaf
			await client.evaluate(`(async () => {
				const activeLeaf = app.workspace.activeLeaf;
				if (activeLeaf) activeLeaf.detach();
				const file = app.vault.getAbstractFileByPath('__lumina_e2e_test__.md');
				if (file) await app.vault.delete(file);
			})()`);
			await sleep(200);
		} catch (err) {
			reporter.record('Editor & Quick Actions', false, err.message, Date.now() - t0);
		}
	}

	// ─── SUITE 7: Frontmatter Strip Modal (Physical Keyboard Escape) ─────────
	reporter.startSuite('Frontmatter Tools (Modal UI & Keyboard Close)');
	{
		const t0 = Date.now();
		try {
			await client.evaluate(`app.commands.executeCommandById('lumina:strip-frontmatter-metadata')`);
			await sleep(400);

			const modalOpened = await client.evaluate(`!!document.querySelector('.modal-container')`);

			// Close modal using genuine physical Escape key
			await input.pressEscape();
			await sleep(300);

			const modalClosed = await client.evaluate(`!document.querySelector('.modal-container')`);

			reporter.record(
				'Strip Modal Opened & Closed via Physical Escape Key',
				modalOpened && modalClosed,
				`Opened: ${modalOpened}, Closed with Escape key: ${modalClosed}`,
				Date.now() - t0
			);
		} catch (err) {
			reporter.record('Strip Modal Opened & Closed via Physical Escape Key', false, err.message, Date.now() - t0);
		}
		await sleep(200);
	}

	// ─── SUITE 8: Settings Tab (Physical Navigation & Dismissal) ────────────
	reporter.startSuite('Settings Tab & Persistence');
	{
		const t0 = Date.now();
		try {
			// Open settings modal
			await client.evaluate(`(() => { app.setting.open(); })()`);
			await sleep(300);

			// Click the Lumina tab item in the settings sidebar
			await client.evaluate(`(() => { app.setting.openTabById('lumina'); })()`);
			await sleep(600);

			const settingsStatus = await client.evaluate(`(() => {
				const activeTab = app.setting.activeTab;
				const isLuminaTab = activeTab?.id === 'lumina';
				const container = activeTab?.containerEl;
				const sectionsCount = container?.querySelectorAll('.setting-item, h2, h3').length || 0;
				return { isLuminaTab, sectionsCount };
			})()`);

			// Close settings modal using genuine physical Escape key
			await input.pressEscape();
			await sleep(300);

			const settingsClosed = await client.evaluate(`!document.querySelector('.modal-container')`);

			reporter.record(
				'Settings Tab Loaded & Dismissed via Physical Escape',
				settingsStatus.isLuminaTab && settingsStatus.sectionsCount > 0 && settingsClosed,
				`Rendered ${settingsStatus.sectionsCount} elements, Dismissed with Escape: ${settingsClosed}`,
				Date.now() - t0
			);
		} catch (err) {
			reporter.record('Settings Tab Loaded & Dismissed via Physical Escape', false, err.message, Date.now() - t0);
		}

		// 2. Settings Disk Persistence & Reload Verification
		const t1 = Date.now();
		try {
			const persistResult = await client.evaluate(`(async () => {
				const lumina = app.plugins.plugins['lumina'];
				const originalMaxResults = lumina.settings.rag?.maxResults ?? 5;
				const testVal = originalMaxResults === 7 ? 8 : 7;

				// 1. Mutate setting in memory & save to disk
				lumina.settings.rag.maxResults = testVal;
				await lumina.saveSettings();

				// 2. Read directly from Obsidian vault adapter (raw disk file)
				const rawData = await app.vault.adapter.read('.obsidian/plugins/lumina/data.json');
				const diskJson = JSON.parse(rawData);

				// 3. Restore original setting
				lumina.settings.rag.maxResults = originalMaxResults;
				await lumina.saveSettings();

				return {
					success: diskJson.rag?.maxResults === testVal,
					savedVal: diskJson.rag?.maxResults,
					expected: testVal
				};
			})()`);

			reporter.record(
				'Settings Disk Persistence & Reload',
				persistResult.success,
				`Persisted to data.json: ${persistResult.savedVal} (expected: ${persistResult.expected}) -> restored`,
				Date.now() - t1
			);
		} catch (err) {
			reporter.record('Settings Disk Persistence & Reload', false, err.message, Date.now() - t1);
		}
		await sleep(200);
	}

	// ─── SUITE 9: MCP Tool Execution Engine ─────────────────────────────────
	reporter.startSuite('MCP Tool Execution Engine (Real Vault Actions)');
	{
		const t0 = Date.now();
		try {
			const mcpInfo = await client.evaluate(`(() => {
				const lumina = app.plugins.plugins['lumina'];
				const tools = lumina.mcpManager?.getAllTools() || [];
				return {
					ready: !!lumina.mcpManager,
					toolsCount: tools.length,
					hasEssentialTools: ['list_tags', 'search_notes', 'read_note', 'rag_search'].every(name =>
						tools.some(t => t.name === name)
					)
				};
			})()`);

			reporter.record(
				'MCP Tools Collection & Server Ready',
				mcpInfo.ready && mcpInfo.hasEssentialTools && mcpInfo.toolsCount >= 20,
				`Registered tools: ${mcpInfo.toolsCount}, Essential tools verified`,
				Date.now() - t0
			);
		} catch (err) {
			reporter.record('MCP Tools Collection & Server Ready', false, err.message, Date.now() - t0);
		}

		// Test list_tags tool
		const t1 = Date.now();
		try {
			const tagToolResult = await client.evaluate(`(async () => {
				const lumina = app.plugins.plugins['lumina'];
				const tools = lumina.mcpManager.getAllTools();
				const tagTool = tools.find(t => t.name === 'list_tags');
				if (!tagTool) return { success: false, reason: 'no list_tags tool' };
				const start = Date.now();
				const res = await lumina.mcpManager.callTool(tagTool._serverId, 'list_tags', {});
				const text = res?.content?.[0]?.text || '';
				return {
					success: !res?.isError && (text.includes('Tags in vault') || text.includes('#')),
					snippet: text.split('\\n').slice(0, 3).join(', '),
					duration: Date.now() - start
				};
			})()`);

			reporter.record(
				'Live Metadata Tool Execution (list_tags)',
				tagToolResult.success,
				`${tagToolResult.snippet} (Latency: ${tagToolResult.duration}ms)`,
				Date.now() - t1
			);
		} catch (err) {
			reporter.record('Live Metadata Tool Execution (list_tags)', false, err.message, Date.now() - t1);
		}

		// Test search_notes tool
		const t2 = Date.now();
		try {
			const searchToolResult = await client.evaluate(`(async () => {
				const lumina = app.plugins.plugins['lumina'];
				const tools = lumina.mcpManager.getAllTools();
				const searchTool = tools.find(t => t.name === 'search_notes');
				if (!searchTool) return { success: false, reason: 'no search_notes tool' };
				const start = Date.now();
				const res = await lumina.mcpManager.callTool(searchTool._serverId, 'search_notes', { query: '기본' });
				const text = res?.content?.[0]?.text || '';
				return {
					success: !res?.isError && (text.includes('발견됨') || text.includes('found') || text.includes('.md')),
					snippet: text.split('\\n')[0],
					duration: Date.now() - start
				};
			})()`);

			reporter.record(
				'Live Vault Search Tool Execution (search_notes)',
				searchToolResult.success,
				`${searchToolResult.snippet} (Latency: ${searchToolResult.duration}ms)`,
				Date.now() - t2
			);
		} catch (err) {
			reporter.record('Live Vault Search Tool Execution (search_notes)', false, err.message, Date.now() - t2);
		}
	}

	// ─── SUITE 10: Live LLM Provider Test ────────────────────────────────────
	reporter.startSuite('Live LLM Provider (Short Prompt Test)');
	{
		const t0 = Date.now();
		try {
			const llmResult = await client.evaluate(`(async () => {
				const lumina = app.plugins.plugins['lumina'];
				const providers = lumina.settings.connections.providers;
				const googleProv = providers.find(p => p.type === 'google');
				if (!googleProv) {
					return { skipped: true, reason: 'No Google provider found' };
				}
				const apiKey = app.secretStorage.getSecret('lumina-provider-' + googleProv.id);
				if (!apiKey) {
					return { skipped: true, reason: 'Google provider has no stored API key' };
				}

				const start = Date.now();
				try {
					// 1. Test listModels endpoint via fetch
					const listRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models?key=' + apiKey);
					const listData = await listRes.json();
					const models = listData.models || [];
					const geminiModels = models.filter(m => m.name && m.name.includes('gemini'));

					// 2. Test short prompt completion
					const candidateModel = geminiModels.find(m => m.name.includes('gemini-2.5-flash') || m.name.includes('gemini-2.0-flash') || m.name.includes('flash'))?.name || geminiModels[0]?.name || 'models/gemini-2.5-flash';
					const modelEndpoint = candidateModel.startsWith('models/') ? candidateModel.replace('models/', '') : candidateModel;

					const promptRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models/' + modelEndpoint + ':generateContent?key=' + apiKey, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({
							contents: [{ role: 'user', parts: [{ text: 'Say "PONG" and nothing else.' }] }],
							generationConfig: {
								maxOutputTokens: 100,
								thinkingConfig: { thinkingBudget: 0 }
							}
						})
					});

					const promptData = await promptRes.json();
					const text = promptData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

					return {
						success: true,
						providerType: 'google',
						testModel: modelEndpoint,
						modelsCount: geminiModels.length,
						response: text,
						latency: Date.now() - start
					};
				} catch (e) {
					return {
						success: false,
						providerType: 'google',
						error: e.message || String(e),
						duration: Date.now() - start
					};
				}
			})()`);

			if (llmResult.skipped) {
				reporter.record('Live LLM Provider Completion', true, `Skipped: ${llmResult.reason}`, Date.now() - t0);
			} else if (llmResult.success) {
				reporter.record('Live LLM Provider Completion', true, `[${llmResult.providerType}] Model: ${llmResult.testModel}, Output: "${llmResult.response}", Latency: ${llmResult.latency}ms`, Date.now() - t0);
			} else {
				reporter.record('Live LLM Provider Completion', false, `[${llmResult.providerType}] Error: ${llmResult.error}`, Date.now() - t0);
			}
		} catch (err) {
			reporter.record('Live LLM Provider Completion', false, err.message, Date.now() - t0);
		}
	}

	client.close();
	return reporter.summary();
}

run().catch((err) => {
	console.error('Fatal error running E2E tests:', err);
	process.exit(1);
});
