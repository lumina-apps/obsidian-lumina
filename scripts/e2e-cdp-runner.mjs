/**
 * Obsidian Lumina E2E Automated Test Runner via CDP (Chrome DevTools Protocol)
 * Connects to Obsidian on port 9222 and executes automated integration tests
 * simulating genuine physical mouse clicks, keyboard input, and lifecycle flows.
 * open -a Obsidian --args --remote-debugging-port=9222
 */

import { readFileSync } from 'fs';
import { startMockOpenAiServer } from './e2e/mock-openai-server.mjs';
import {
	cleanupProArtifacts,
	runBatchStudioProSuite,
	runFreemiumPreviewSuite,
	runMobileProSuites,
	runProEntitlementGateSuite,
	runSplitChatProSuite,
	runVoiceToNoteProSuite,
} from './e2e/pro-suites.mjs';

const CDP_PORT = 9222;
const localManifest = JSON.parse(readFileSync('./manifest.json', 'utf8'));

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

	async send(method, params = {}, timeoutMs = 25000) {
		const id = this.msgId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				if (this.pending.has(id)) {
					this.pending.delete(id);
					reject(new Error(`CDP request timed out after ${timeoutMs}ms: ${method}`));
				}
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (res) => {
					clearTimeout(timer);
					resolve(res);
				},
				reject: (err) => {
					clearTimeout(timer);
					reject(err);
				},
			});
			this.ws.send(JSON.stringify({ id, method, params }));
		});
	}

	async evaluate(expression, timeoutMs = 25000) {
		const result = await this.send('Runtime.evaluate', {
			expression,
			returnByValue: true,
			awaitPromise: true,
		}, timeoutMs);
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
			skipped: false,
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

	recordSkip(testName, reason = '', durationMs = 0) {
		const item = {
			suite: this.currentSuite,
			test: testName,
			passed: true,
			skipped: true,
			details: reason,
			durationMs,
		};
		this.results.push(item);
		console.log(`  ⚠️ SKIP [${durationMs}ms] ${testName}`);
		if (reason) {
			console.log(`     └─ ${reason}`);
		}
	}

	summary() {
		const total = this.results.length;
		const skipped = this.results.filter((r) => r.skipped).length;
		const passed = this.results.filter((r) => r.passed && !r.skipped).length;
		const failed = this.results.filter((r) => !r.passed).length;
		console.log(`\n==================================================`);
		console.log(`🏁 TEST EXECUTION SUMMARY`);
		console.log(`==================================================`);
		console.log(`Total: ${total} | Passed: ${passed} | Skipped: ${skipped} | Failed: ${failed}`);
		if (failed > 0) {
			console.log(`\nFailed Tests:`);
			for (const r of this.results.filter((r) => !r.passed)) {
				console.log(`  ❌ [${r.suite}] ${r.test}: ${r.details}`);
			}
		}
		console.log(`==================================================\n`);
		return { total, passed, skipped, failed, results: this.results };
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

	// 이전 비정상 종료 실행에서 남은 테스트 파일 및 탭 정리
	await client.evaluate(`(async () => {
		const cleanupPaths = [
			'__lumina_e2e_test__.md',
			'__lumina_e2e_mcp_test__.md',
			'__lumina_e2e_voice_test__.md',
			'__lumina_e2e_batch_test__',
		];
		for (const p of cleanupPaths) {
			const f = app.vault.getAbstractFileByPath(p);
			if (f) await app.vault.delete(f, true);
		}
		app.workspace.getLeavesOfType('lumina-chat').forEach(l => l.detach());
		app.workspace.getLeavesOfType('lumina-debug-panel').forEach(l => l.detach());
		app.workspace.getLeavesOfType('lumina-graph').forEach(l => l.detach());
		app.workspace.getLeavesOfType('lumina-split-chat').forEach(l => l.detach());
		app.workspace.getLeavesOfType('lumina-batch-studio').forEach(l => l.detach());
	})()`);
	await cleanupProArtifacts(client);

	const mobileOnly = process.argv.includes('--mobile-only');
	const proOnly = process.argv.includes('--pro-only');
	const requiredMode = process.argv.includes('--require-pro')
		? 'pro-active'
		: process.argv.includes('--require-preview')
			? 'freemium-preview'
			: process.argv.includes('--require-free')
				? 'free-hidden'
				: null;

	const mockServer = await startMockOpenAiServer();
	console.log(`Started Mock OpenAI Server at ${mockServer.url}`);

	try {
		if (mobileOnly) {
			await runMobileSuite(client, input, reporter, mockServer, { requiredMode });
			return reporter.summary();
		}
		if (proOnly) {
			await runAllProSuites(client, input, reporter, mockServer, { requiredMode });
			await runMobileSuite(client, input, reporter, mockServer, { requiredMode });
			return reporter.summary();
		}
	} finally {
		if (mobileOnly || proOnly) {
			await cleanupProArtifacts(client).catch(() => {});
			await mockServer.close().catch(() => {});
			client.close();
		}
	}

	// ─── SUITE 1: Core Lifecycle & Registrations ─────────────────────────────
	reporter.startSuite('Core Lifecycle & Registrations');
	{
		const t0 = Date.now();
		try {
			const info = await client.evaluate(`(async () => {
				if (typeof app.plugins.loadManifests === 'function') {
					await app.plugins.loadManifests();
				}
				const p = app.plugins.plugins['lumina'];
				return {
					loaded: !!p,
					manifestVersion: app.plugins.manifests['lumina']?.version,
					vaultName: app.vault.getName(),
					hasRibbon: !!document.querySelector('.side-dock-ribbon-action[aria-label*="Lumina"]')
				};
			})()`);

			reporter.record('Plugin Loaded & Version Match', info.loaded && info.manifestVersion === localManifest.version, `Version: ${info.manifestVersion}`, Date.now() - t0);
			reporter.record('Ribbon Icon Present', info.hasRibbon, `Vault: ${info.vaultName}`, Date.now() - t0);
		} catch (err) {
			reporter.record('Plugin Loaded & Version Match', false, err.message, Date.now() - t0);
		}

		// Verify Core Feature Managers
		const tManagers = Date.now();
		try {
			const managers = await client.evaluate(`(() => {
				const p = app.plugins.plugins['lumina'];
				return {
					hasCanvas: !!p?.canvasManager,
					hasEvents: !!p?.eventManager,
					hasCommands: !!p?.commandManager,
					hasSettings: !!p?.settingsManager
				};
			})()`);

			reporter.record(
				'Core Feature Managers Initialized',
				managers.hasCanvas && managers.hasEvents && managers.hasCommands && managers.hasSettings,
				`Canvas: ${managers.hasCanvas}, Events: ${managers.hasEvents}, Commands: ${managers.hasCommands}, Settings: ${managers.hasSettings}`,
				Date.now() - tManagers
			);
		} catch (err) {
			reporter.record('Core Feature Managers Initialized', false, err.message, Date.now() - tManagers);
		}

		// Verify Dynamic Plugin Reload & Re-initialization
		const tReload = Date.now();
		try {
			const reloadResult = await client.evaluate(`(async () => {
				if (app.plugins.enabledPlugins.has('lumina')) {
					await app.plugins.disablePlugin('lumina');
					await new Promise(r => setTimeout(r, 200));
					const unloaded = !app.plugins.plugins['lumina'];
					if (window.require && window.require.cache) {
						for (const k of Object.keys(window.require.cache)) {
							if (k.includes('obsidian-lumina') || k.includes('plugins/lumina')) {
								delete window.require.cache[k];
							}
						}
					}
					await app.plugins.enablePlugin('lumina');
					await new Promise(r => setTimeout(r, 500));
					const p = app.plugins.plugins['lumina'];
					const reloaded = !!p && !!p.commandManager && !!p.mcpManager;
					return { success: unloaded && reloaded, unloaded, reloaded };
				}
				return { success: false, reason: 'plugin not enabled' };
			})()`);

			reporter.record(
				'Plugin Reload & Lifecycle Cycle',
				reloadResult.success,
				`Clean unload: ${reloadResult.unloaded}, Re-enable: ${reloadResult.reloaded}`,
				Date.now() - tReload
			);
		} catch (err) {
			reporter.record('Plugin Reload & Lifecycle Cycle', false, err.message, Date.now() - tReload);
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

	// ─── SUITE 1.5: Empty Workspace Resilience (Edge Cases) ──────────────────
	reporter.startSuite('Empty Workspace Resilience (Edge Cases)');
	try {
		const tEmptyAll = Date.now();
		const emptyResilience = await client.evaluate(`(async () => {
			// 1. Close ALL markdown leaves
			app.workspace.getLeavesOfType('markdown').forEach(l => l.detach());
			await new Promise(r => setTimeout(r, 100));
			
			// 2. Open all UI panels that might depend on activeFile
			app.commands.executeCommandById('lumina:open-chat');
			app.commands.executeCommandById('lumina:open-graph-view');
			app.commands.executeCommandById('lumina:open-devlog');
			
			await new Promise(r => setTimeout(r, 600)); // Wait for all to mount

			const chatLeaves = app.workspace.getLeavesOfType('lumina-chat');
			const graphLeaves = app.workspace.getLeavesOfType('lumina-graph');
			const debugLeaves = app.workspace.getLeavesOfType('lumina-debug-panel');

			const success = chatLeaves.length > 0 && graphLeaves.length > 0 && debugLeaves.length > 0;
			
			// Cleanup for next suite
			chatLeaves.forEach(l => l.detach());
			graphLeaves.forEach(l => l.detach());
			debugLeaves.forEach(l => l.detach());
			await new Promise(r => setTimeout(r, 200));

			return { success };
		})()`);

		reporter.record(
			'Mount All Views on Empty Workspace without Crash',
			emptyResilience.success,
			'Chat, Graph, Debug panels rendered safely with null activeFile',
			Date.now() - tEmptyAll
		);
	} catch (err) {
		reporter.record('Mount All Views on Empty Workspace without Crash', false, err.message, 0);
	}

	// ─── SUITE 2: Chat View (Physical Mouse Click & Typing Simulation) ───────
	reporter.startSuite('Chat View (Physical Mouse & Keyboard Interaction)');
	try {
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

			const discoveryStatus = await client.evaluate(`(() => {
				const tabs = document.querySelectorAll('.lumina-sidebar__tab');
				const isTabActive = tabs[1]?.classList.contains('is-active');
				const hasDiscovery = !!document.querySelector('.lumina-discovery');
				return { isTabActive, hasDiscovery };
			})()`);

			// Click AI Chat Tab back (1st button)
			await input.click('.lumina-sidebar__tab:nth-child(1)');
			await sleep(300);

			const chatStatus = await client.evaluate(`(() => {
				const tabs = document.querySelectorAll('.lumina-sidebar__tab');
				const isTabActive = tabs[0]?.classList.contains('is-active');
				const hasChatTextarea = !!document.querySelector('.lumina-chat-view textarea');
				return { isTabActive, hasChatTextarea };
			})()`);

			reporter.record(
				'Physical Tab Click & Navigation',
				discoveryStatus.isTabActive && discoveryStatus.hasDiscovery && chatStatus.isTabActive && chatStatus.hasChatTextarea,
				`Switched to Discovery (active: ${discoveryStatus.isTabActive}, mounted: ${discoveryStatus.hasDiscovery}) -> Switched back to Chat (active: ${chatStatus.isTabActive}, mounted: ${chatStatus.hasChatTextarea})`,
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

		// 6. Chat History List Toggle & Back Navigation
		const tHistory = Date.now();
		try {
			// Find and click the history button in chat header
			const historyBtnSelector = '.lumina-chat__header .lumina-chat__icon-btn[aria-label*="기록"], .lumina-chat__header .lumina-chat__icon-btn[aria-label*="History"]';
			await input.click(historyBtnSelector);
			await sleep(300);

			let historyMounted = await client.evaluate(`(() => {
				return !!document.querySelector('.lumina-history');
			})()`);

			if (!historyMounted) {
				// Fallback to direct click if tooltip intercepted physical mouse
				await client.evaluate(`(() => {
					const btn = document.querySelector('.lumina-chat__header .lumina-chat__icon-btn[aria-label*="기록"], .lumina-chat__header .lumina-chat__icon-btn[aria-label*="History"]');
					btn?.click();
				})()`);
				await sleep(300);
				historyMounted = await client.evaluate(`(() => {
					return !!document.querySelector('.lumina-history');
				})()`);
			}

			if (!historyMounted) {
				throw new Error('Chat history view failed to mount');
			}

			// Click the back button inside history header
			await input.click('.lumina-history__header-title button');
			await sleep(300);

			let historyClosed = await client.evaluate(`(() => {
				const historyEl = document.querySelector('.lumina-history');
				const textareaEl = document.querySelector('.lumina-chat-view textarea');
				return !historyEl && !!textareaEl;
			})()`);

			if (!historyClosed) {
				await client.evaluate(`(() => {
					const backBtn = document.querySelector('.lumina-history__header-title button');
					backBtn?.click();
				})()`);
				await sleep(300);
				historyClosed = await client.evaluate(`(() => {
					const historyEl = document.querySelector('.lumina-history');
					const textareaEl = document.querySelector('.lumina-chat-view textarea');
					return !historyEl && !!textareaEl;
				})()`);
			}

			reporter.record(
				'Chat History Toggle & Back Navigation',
				historyMounted && historyClosed,
				`History mounted: ${historyMounted}, Closed & Textarea restored: ${historyClosed}`,
				Date.now() - tHistory
			);
		} catch (err) {
			reporter.record('Chat History Toggle & Back Navigation', false, err.message, Date.now() - tHistory);
		}
	} finally {
		// Teardown: close leaves
		await client.evaluate(`(() => {
			const leaves = app.workspace.getLeavesOfType('lumina-chat');
			leaves.forEach(l => l.detach());
		})()`);
		await sleep(200);
	}

	// ─── SUITE: Chat Context & Attachment Interactions ──────────────────────
	reporter.startSuite('Chat Context & Attachment Interactions');
	try {
		// Ensure chat view is open
		await client.evaluate(`app.commands.executeCommandById('lumina:open-chat')`);
		await sleep(500);

		// 1. Context Selector Popup & Attachment Lifecycle
		const tAttach = Date.now();
		try {
			// Click the @ context button in toolbar
			await client.evaluate(`(() => {
				const btn = document.querySelector('.lumina-chat__toolbar-btn[aria-label*="컨텍스트"], .lumina-chat__toolbar-btn[aria-label*="Context"], .lumina-chat__toolbar-group button:first-child');
				btn?.click();
			})()`);
			await sleep(400);

			let popupMounted = await client.evaluate(`(() => {
				return !!document.querySelector('.lumina-popup-selector');
			})()`);

			if (!popupMounted) {
				// Fallback: input @ in textarea to trigger context popup
				await client.evaluate(`(() => {
					const ta = document.querySelector('.lumina-chat-view textarea');
					if (ta) {
						ta.focus();
						ta.value = '@';
						ta.dispatchEvent(new Event('input', { bubbles: true }));
					}
				})()`);
				await sleep(400);
				popupMounted = await client.evaluate(`(() => {
					return !!document.querySelector('.lumina-popup-selector');
				})()`);
			}

			// Select first category / item inside popup
			let chipAdded = false;
			if (popupMounted) {
				await client.evaluate(`(() => {
					const firstItem = document.querySelector('.lumina-popup-selector .lumina-popup-selector__item');
					firstItem?.click();
				})()`);
				await sleep(400);

				// If it entered a category (e.g. Files), click first file item inside category
				const stillInPopup = await client.evaluate(`!!document.querySelector('.lumina-popup-selector')`);
				if (stillInPopup) {
					await client.evaluate(`(() => {
						const subItem = document.querySelector('.lumina-popup-selector .lumina-popup-selector__item');
						subItem?.click();
					})()`);
					await sleep(400);
				}

				chipAdded = await client.evaluate(`(() => {
					const chips = document.querySelectorAll('.lumina-chat__attachment-chip');
					return chips.length > 0;
				})()`);
			}

			// Remove attachment chip
			let chipRemoved = false;
			if (chipAdded) {
				await client.evaluate(`(() => {
					const removeBtn = document.querySelector('.lumina-chat__attachment-chip .lumina-chat__attachment-remove');
					removeBtn?.click();
				})()`);
				await sleep(300);

				chipRemoved = await client.evaluate(`(() => {
					return document.querySelectorAll('.lumina-chat__attachment-chip').length === 0;
				})()`);
			}

			reporter.record(
				'Context Selector & Attachment Chip Lifecycle',
				popupMounted && chipAdded && chipRemoved,
				`Popup: ${popupMounted}, Chip Added: ${chipAdded}, Chip Removed: ${chipRemoved}`,
				Date.now() - tAttach
			);
		} catch (err) {
			reporter.record('Context Selector & Attachment Chip Lifecycle', false, err.message, Date.now() - tAttach);
		}

		// 2. Active Note Context Toggle & Token Estimation Badge
		const tActiveNote = Date.now();
		try {
			const toggleResult = await client.evaluate(`(async () => {
				const badges = Array.from(document.querySelectorAll('.lumina-chat__context-badge'));
				if (badges.length === 0) return { success: false, reason: 'Badge not found' };
				// Active Note 토글 배지는 툴바 우측 마지막 .lumina-chat__context-badge
				const noteBadge = badges[badges.length - 1];

				const getBadgeState = (el) => ({
					isActive: el.classList.contains('is-active'),
					isUnavailable: el.classList.contains('is-unavailable'),
					label: (el.textContent || '').trim(),
					ariaLabel: el.getAttribute('aria-label') || '',
				});

				const before = getBadgeState(noteBadge);
				noteBadge.click();
				await new Promise(r => setTimeout(r, 100));
				const after = getBadgeState(noteBadge);
				// toggle back to original
				noteBadge.click();
				await new Promise(r => setTimeout(r, 100));

				const stateChanged =
					before.isActive !== after.isActive ||
					before.isUnavailable !== after.isUnavailable ||
					before.label !== after.label ||
					before.ariaLabel !== after.ariaLabel;

				return {
					success: stateChanged,
					initialActive: before.isActive,
					toggledActive: after.isActive,
					beforeLabel: before.label,
					afterLabel: after.label,
					hasTokenBadge: !!document.querySelector('.lumina-chat__token-stats, .lumina-chat__hint-inline')
				};
			})()`);

			reporter.record(
				'Active Note Context Toggle & Token Badge',
				toggleResult.success,
				`Toggled: ${toggleResult.initialActive} (${toggleResult.beforeLabel}) -> ${toggleResult.toggledActive} (${toggleResult.afterLabel}), Token badge: ${toggleResult.hasTokenBadge}`,
				Date.now() - tActiveNote
			);
		} catch (err) {
			reporter.record('Active Note Context Toggle & Token Badge', false, err.message, Date.now() - tActiveNote);
		}

		// 3. Drag & Drop Visual State and Internal Obsidian Note Drop
		const tDrop = Date.now();
		try {
			const dropResult = await client.evaluate(`(async () => {
				const area = document.querySelector('.lumina-chat__input-area');
				if (!area) return { success: false, reason: 'Input area not found' };

				// 1) Test dragenter -> wait for Svelte 5 DOM flush -> check .is-dragover
				area.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true }));
				await new Promise(r => setTimeout(r, 100));
				const hasDragOver = area.classList.contains('is-dragover');

				// 2) Test dragleave -> wait for Svelte 5 DOM flush -> check removed .is-dragover
				area.dispatchEvent(new DragEvent('dragleave', { bubbles: true, cancelable: true }));
				await new Promise(r => setTimeout(r, 100));
				const dragOverRemoved = !area.classList.contains('is-dragover');

				// 3) Test native Obsidian note drop
				const files = app.vault.getMarkdownFiles();
				if (files.length === 0) return { success: false, reason: 'No markdown files in vault' };
				const targetNote = files.find(f => app.metadataCache.getFirstLinkpathDest(f.basename, '')?.path === f.path) || files[0];

				const dropEvent = new DragEvent('drop', { bubbles: true, cancelable: true });
				Object.defineProperty(dropEvent, 'dataTransfer', {
					value: {
						files: [],
						getData: (format) => format === 'text/plain' ? '[[' + targetNote.basename + ']]' : '',
					}
				});
				area.dispatchEvent(dropEvent);
				await new Promise(r => setTimeout(r, 400));

				const chips = document.querySelectorAll('.lumina-chat__attachment-chip');
				const chipMounted = chips.length > 0;
				const chipName = document.querySelector('.lumina-chat__attachment-name')?.textContent || '';

				// 4) Test click attachment chip to open note in editor
				const chip = document.querySelector('.lumina-chat__attachment-chip');
				chip?.click();
				await new Promise(r => setTimeout(r, 400));
				const activeFileOpened = app.workspace.getActiveFile()?.path === targetNote.path;

				// Cleanup chip
				document.querySelector('.lumina-chat__attachment-remove')?.click();
				await new Promise(r => setTimeout(r, 200));

				return {
					success: hasDragOver && dragOverRemoved && chipMounted && activeFileOpened,
					hasDragOver,
					dragOverRemoved,
					chipMounted,
					activeFileOpened,
					chipName: chipName.trim()
				};
			})()`);

			reporter.record(
				'Drag & Drop Dragover Feedback & Native Note Drop & Click-to-Open',
				dropResult.success,
				`Dragover: ${dropResult.hasDragOver}, Note: "${dropResult.chipName}", Click-to-Open: ${dropResult.activeFileOpened}`,
				Date.now() - tDrop
			);
		} catch (err) {
			reporter.record('Drag & Drop Dragover Feedback & Native Note Drop', false, err.message, Date.now() - tDrop);
		}

		// 4. Pasted Image Attachment & Vault Auto-Save
		const tPaste = Date.now();
		try {
			const pasteResult = await client.evaluate(`(async () => {
				const inputArea = document.querySelector('.lumina-chat__input-area');
				if (!inputArea) return { success: false, reason: 'Input area not found' };

				const pngBytes = new Uint8Array([
					137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
					0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196,
					137, 0, 0, 0, 10, 73, 68, 65, 84, 120, 156, 99, 0, 1, 0, 0,
					5, 0, 1, 13, 10, 45, 180, 0, 0, 0, 0, 73, 69, 78, 68,
					174, 66, 96, 130
				]);
				const testFile = new File([pngBytes], 'Pasted_Image_E2E_Test.png', { type: 'image/png' });

				const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
				Object.defineProperty(pasteEvent, 'clipboardData', {
					value: {
						files: [testFile],
						items: [
							{
								kind: 'file',
								type: 'image/png',
								getAsFile: () => testFile
							}
						],
						getData: (format) => ''
					}
				});

				inputArea.dispatchEvent(pasteEvent);
				await new Promise(r => setTimeout(r, 600));

				const chips = Array.from(document.querySelectorAll('.lumina-chat__attachment-chip'));
				const chipMounted = chips.some(c => c.textContent.includes('Pasted image') || c.textContent.includes('Pasted_Image'));

				const vaultFiles = app.vault.getFiles();
				const createdImage = vaultFiles.find(f => f.name.includes('Pasted image') && f.extension === 'png');
				const vaultFileCreated = !!createdImage;

				// Cleanup chip
				document.querySelector('.lumina-chat__attachment-remove')?.click();
				await new Promise(r => setTimeout(r, 200));

				// Cleanup created image file
				if (createdImage) {
					await app.vault.delete(createdImage, true);
				}

				return {
					success: chipMounted && vaultFileCreated,
					chipMounted,
					vaultFileCreated,
					createdPath: createdImage?.path || ''
				};
			})()`);

			reporter.record(
				'Pasted Image Attachment to Vault & Input Chip Lifecycle',
				pasteResult.success,
				`Chip Mounted: ${pasteResult.chipMounted}, Vault File Created: ${pasteResult.vaultFileCreated} (${pasteResult.createdPath})`,
				Date.now() - tPaste
			);
		} catch (err) {
			reporter.record('Pasted Image Attachment to Vault & Input Chip Lifecycle', false, err.message, Date.now() - tPaste);
		}

		// 5. Chat History Session Persistence & Attachment Restore Click-to-Open
		const tHistoryRestore = Date.now();
		try {
			const historyResult = await client.evaluate(`(async () => {
				const cleanSeg = (s) => (s || '').trim().replace(/\\\\/g, '/').replace(/^\\/+|\\/+$/g, '');
				const ensureFolder = async (folderPath) => {
					let cur = '';
					for (const seg of folderPath.split('/').filter(Boolean)) {
						cur = cur ? cur + '/' + seg : seg;
						if (!app.vault.getAbstractFileByPath(cur)) {
							await app.vault.createFolder(cur);
						}
					}
				};

				const lumina = app.plugins.plugins['lumina'];
				const rootHistoryDir = cleanSeg(lumina.settings.chat.historyPath) || 'chatHistory';
				const projSettings = lumina.settings.projects;
				const activeProj = projSettings?.list?.find(p => p.id === projSettings?.activeProjectId);
				const subFolder = cleanSeg(activeProj?.historySubfolder);
				const historyDir = subFolder ? rootHistoryDir + '/' + subFolder : rootHistoryDir;

				const files = app.vault.getMarkdownFiles().filter(f => !f.path.startsWith(rootHistoryDir + '/') && !f.path.startsWith('Lumina Exports'));
				if (files.length === 0) return { success: false, chipMounted: false, chipText: '', fileOpened: false, targetPath: 'No markdown files in vault' };
				const targetNote = files.find(f => app.metadataCache.getFirstLinkpathDest(f.basename, '')?.path === f.path) || files[0];

				await ensureFolder(historyDir);

				const testSessionId = 'e2e-restore-test-' + Date.now();
				const sessionData = {
					id: testSessionId,
					title: 'E2E Attachment History Test',
					createdAt: Date.now(),
					updatedAt: Date.now(),
					providerId: 'google',
					modelId: 'gemini-2.5-flash',
					messages: [
						{
							id: 'msg-user-1',
							role: 'user',
							content: '노트 첨부파일을 확인합니다.',
							timestamp: Date.now(),
							attachments: [
								{
									type: 'external_file',
									path: '',
									name: targetNote.basename
								}
							]
						},
						{
							id: 'msg-asst-1',
							role: 'assistant',
							content: '노트 확인이 완료되었습니다.',
							timestamp: Date.now() + 1000,
							isStreaming: false
						}
					]
				};

				const jsonStr = JSON.stringify(sessionData);
				const b64 = btoa(unescape(encodeURIComponent(jsonStr)));
				const mdContent = [
					'---',
					'id: ' + testSessionId,
					'title: "E2E Attachment History Test"',
					'created: ' + new Date().toISOString(),
					'updated: ' + new Date().toISOString(),
					'---',
					'',
					'**👤 You**',
					'',
					'노트 첨부파일을 확인합니다.',
					'',
					'---',
					'',
					'**✦ Lumina**',
					'',
					'노트 확인이 완료되었습니다.',
					'',
					'<!-- LUMINA_HISTORY_DATA_V2: ' + b64 + ' -->'
				].join('\\n');

				const filePath = historyDir + '/__e2e_history_test__.md';
				const existing = app.vault.getAbstractFileByPath(filePath);
				if (existing) await app.vault.delete(existing, true);
				await app.vault.create(filePath, mdContent);

				try {
					// Open history view if not already open
					if (!document.querySelector('.lumina-history')) {
						const histBtn = document.querySelector('.lumina-chat__header .lumina-chat__icon-btn[aria-label*="기록"], .lumina-chat__header .lumina-chat__icon-btn[aria-label*="History"]');
						histBtn?.click();
						await new Promise(r => setTimeout(r, 400));
					}

					// Click refresh button in history header
					const refreshBtn = document.querySelector('.lumina-history__header button[aria-label*="새로고침"], .lumina-history__header button[aria-label*="Refresh"]');
					refreshBtn?.click();
					await new Promise(r => setTimeout(r, 500));

					// Find test session item
					const items = Array.from(document.querySelectorAll('.lumina-history__item'));
					const targetItem = items.find(el => el.textContent.includes('E2E Attachment History Test'));
					if (!targetItem) {
						return {
							success: false,
							chipMounted: false,
							chipText: '',
							fileOpened: false,
							targetPath: 'History item not rendered in ' + historyDir
						};
					}

					// Click history item to restore session
					targetItem.click();
					await new Promise(r => setTimeout(r, 600));

					// Verify message bubble attachment chip rendered
					const messageChips = document.querySelectorAll('.lumina-message__attachment-chip');
					const chipMounted = messageChips.length > 0;
					const chipText = messageChips[0]?.textContent?.trim() || '';

					// Click attachment chip in message bubble (testing linkpath fallback for path: "")
					messageChips[0]?.click();
					await new Promise(r => setTimeout(r, 600));

					const activeAfter = app.workspace.getActiveFile()?.path;
					const fileOpened = activeAfter === targetNote.path;

					return {
						success: chipMounted && fileOpened,
						chipMounted,
						chipText,
						fileOpened,
						targetPath: targetNote.path
					};
				} finally {
					const f = app.vault.getAbstractFileByPath(filePath);
					if (f) await app.vault.delete(f, true);
					if (document.querySelector('.lumina-history')) {
						document.querySelector('.lumina-history__header-title button')?.click();
						await new Promise(r => setTimeout(r, 200));
					}
				}
			})()`);

			reporter.record(
				'Chat History Session Restore & Bubble Attachment Fallback Click',
				historyResult.success,
				`Chip Restored: ${historyResult.chipMounted} ("${historyResult.chipText}"), Click-to-Open: ${historyResult.fileOpened} (${historyResult.targetPath})`,
				Date.now() - tHistoryRestore
			);
		} catch (err) {
			reporter.record('Chat History Session Restore & Bubble Attachment Fallback Click', false, err.message, Date.now() - tHistoryRestore);
		}

		// 6. Chat Bubble Document Link & Wikilink Click-to-Open
		const tDocLink = Date.now();
		try {
			const linkResult = await client.evaluate(`(async () => {
				const cleanSeg = (s) => (s || '').trim().replace(/\\\\/g, '/').replace(/^\\/+|\\/+$/g, '');
				const ensureFolder = async (folderPath) => {
					let cur = '';
					for (const seg of folderPath.split('/').filter(Boolean)) {
						cur = cur ? cur + '/' + seg : seg;
						if (!app.vault.getAbstractFileByPath(cur)) {
							await app.vault.createFolder(cur);
						}
					}
				};

				const lumina = app.plugins.plugins['lumina'];
				const rootHistoryDir = cleanSeg(lumina.settings.chat.historyPath) || 'chatHistory';
				const projSettings = lumina.settings.projects;
				const activeProj = projSettings?.list?.find(p => p.id === projSettings?.activeProjectId);
				const subFolder = cleanSeg(activeProj?.historySubfolder);
				const historyDir = subFolder ? rootHistoryDir + '/' + subFolder : rootHistoryDir;

				const files = app.vault.getMarkdownFiles().filter(f => !f.path.startsWith(rootHistoryDir + '/') && !f.path.startsWith('chatHistory') && !f.path.startsWith('Lumina Exports'));
				if (files.length === 0) return { success: false, targetPath: 'No markdown files', openedPath: '', linksFound: 0 };
				const targetNote = files.find(f => app.metadataCache.getFirstLinkpathDest(f.basename, '')?.path === f.path) || files[0];

				await ensureFolder(historyDir);

				const testSessionId = 'e2e-link-test-' + Date.now();
				const basePath = app.vault.adapter.basePath;
				const fileUrl = 'file://' + basePath + '/' + encodeURI(targetNote.path);

				const sessionData = {
					id: testSessionId,
					title: 'E2E Document Link Test',
					createdAt: Date.now(),
					updatedAt: Date.now(),
					providerId: 'google',
					modelId: 'gemini-2.5-flash',
					messages: [
						{
							id: 'link-msg-1',
							role: 'user',
							content: '문서 링크 열기 테스트',
							timestamp: Date.now()
						},
						{
							id: 'link-msg-2',
							role: 'assistant',
							content: '참고 문서: [[' + targetNote.basename + ']] 및 [직접 링크](' + fileUrl + ')',
							timestamp: Date.now() + 100,
							isStreaming: false
						}
					]
				};

				const jsonStr = JSON.stringify(sessionData);
				const b64 = btoa(unescape(encodeURIComponent(jsonStr)));
				const mdContent = [
					'---',
					'id: ' + testSessionId,
					'title: "E2E Document Link Test"',
					'created: ' + new Date().toISOString(),
					'updated: ' + new Date().toISOString(),
					'---',
					'',
					'**👤 You**',
					'',
					'문서 링크 열기 테스트',
					'',
					'---',
					'',
					'**✦ Lumina**',
					'',
					'참고 문서: [[' + targetNote.basename + ']] 및 [직접 링크](' + fileUrl + ')',
					'',
					'<!-- LUMINA_HISTORY_DATA_V2: ' + b64 + ' -->'
				].join('\\n');

				const filePath = historyDir + '/' + testSessionId + '.md';
				await app.vault.create(filePath, mdContent);

				try {
					if (!document.querySelector('.lumina-history')) {
						const histBtn = document.querySelector('.lumina-chat__header .lumina-chat__icon-btn[aria-label*="기록"], .lumina-chat__header .lumina-chat__icon-btn[aria-label*="History"]');
						histBtn?.click();
						await new Promise(r => setTimeout(r, 400));
					}

					const refreshBtn = document.querySelector('.lumina-history__header button[aria-label*="새로고침"], .lumina-history__header button[aria-label*="Refresh"]');
					refreshBtn?.click();
					await new Promise(r => setTimeout(r, 500));

					const items = Array.from(document.querySelectorAll('.lumina-history__item'));
					const targetItem = items.find(el => el.textContent.includes('E2E Document Link Test'));
					if (!targetItem) return { success: false, targetPath: 'History item not rendered in ' + historyDir, openedPath: '', linksFound: 0 };

					targetItem.click();
					await new Promise(r => setTimeout(r, 600));

					const messageEls = document.querySelectorAll('.lumina-message__content');
					const lastMsg = messageEls[messageEls.length - 1];
					const links = Array.from(lastMsg?.querySelectorAll('a') || []);

					if (links.length === 0) return { success: false, targetPath: targetNote.path, openedPath: 'No links rendered', linksFound: 0 };

					// Click the link inside the assistant message bubble
					const wikiLink = links.find(a => a.textContent.includes(targetNote.basename)) || links[0];
					wikiLink.click();
					await new Promise(r => setTimeout(r, 500));

					const activeAfter = app.workspace.getActiveFile()?.path;
					const opened = activeAfter === targetNote.path;

					return {
						success: opened,
						targetPath: targetNote.path,
						openedPath: activeAfter,
						linksFound: links.length
					};
				} finally {
					const f = app.vault.getAbstractFileByPath(filePath);
					if (f) await app.vault.delete(f, true);
					if (document.querySelector('.lumina-history')) {
						document.querySelector('.lumina-history__header-title button')?.click();
						await new Promise(r => setTimeout(r, 200));
					}
				}
			})()`);

			reporter.record(
				'Chat Bubble Document Link & Wikilink Click-to-Open',
				linkResult.success,
				`Target: "${linkResult.targetPath}", Opened: ${linkResult.openedPath} (Links: ${linkResult.linksFound})`,
				Date.now() - tDocLink
			);
		} catch (err) {
			reporter.record('Chat Bubble Document Link & Wikilink Click-to-Open', false, err.message, Date.now() - tDocLink);
		}
	} finally {
		// Cleanup chat leaf
		await client.evaluate(`(() => {
			app.workspace.getLeavesOfType('lumina-chat').forEach(l => l.detach());
		})()`);
		await sleep(200);
	}

	// ─── SUITE 3: Debug Panel View ──────────────────────────────────────────
	reporter.startSuite('Debug Panel (Logging System)');
	try {
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
					hasContainer: !!el?.querySelector('.lumina-debug-view, .debug-panel, div'),
					hasPanel: !!el?.querySelector('.lumina-debug'),
					hasHeader: !!el?.querySelector('.lumina-debug__header'),
					hasFilters: !!el?.querySelector('.lumina-debug__filters')
				};
			})()`);

			reporter.record('Open Debug Panel via Command', debugStatus.open, 'lumina-debug-panel leaf created', Date.now() - t0);
			reporter.record(
				'Debug Panel Subcomponents Mounted',
				debugStatus.hasPanel && debugStatus.hasHeader && debugStatus.hasFilters,
				`Header: ${debugStatus.hasHeader}, Filters: ${debugStatus.hasFilters}`,
				Date.now() - t0
			);

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
	} finally {
		// Teardown
		await client.evaluate(`(() => {
			const leaves = app.workspace.getLeavesOfType('lumina-debug-panel');
			leaves.forEach(l => l.detach());
		})()`);
		await sleep(200);
	}

	// ─── SUITE 4: Graph View ────────────────────────────────────────────────
	reporter.startSuite('Graph View (Semantic Visualizer)');
	try {
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
					hasContainer: !!el?.querySelector('.lumina-graph-view, .lumina-graph-panel, div'),
					hasPanel: !!el?.querySelector('.lumina-graph-panel'),
					hasControls: !!el?.querySelector('.lumina-graph-controls')
				};
			})()`);

			reporter.record('Open Graph View via Command', graphStatus.open, 'lumina-graph leaf created in workspace', Date.now() - t0);
			reporter.record('Graph Container Initialized', graphStatus.hasContainer && graphStatus.hasControls, 'DOM container and controls mounted without crash', Date.now() - t0);
		} catch (err) {
			reporter.record('Open Graph View via Command', false, err.message, Date.now() - t0);
		}
	} finally {
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
					if (!lumina.indexer) return { success: false, reason: 'no indexer' };

					// 인덱스된 청크가 없는 경우 증분 색인 실행
					if (lumina.indexer.indexedParentChunks.length === 0) {
						await lumina.indexer.updateIndex();
					}

					// 기존 인덱스에서 실제 존재하는 키워드 동적 추출 (언어/볼트 독립성 보장)
					let query = 'test';
					const firstChunk = lumina.indexer.indexedParentChunks[0];
					if (firstChunk && firstChunk.text) {
						const sampleWords = firstChunk.text.match(/[\\p{L}\\p{N}]{2,}/gu);
						if (sampleWords && sampleWords.length > 0) {
							query = sampleWords[0];
						}
					}

					const start = Date.now();
					const res = await lumina.mcpManager.callTool(ragTool._serverId, 'rag_search', { query, topK: 3 });
					const text = res?.content?.[0]?.text || '';
					return {
						success: !res?.isError && text.length > 0,
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

	// ─── SUITE 5.5: Discovery Panel UI (Smart Discovery) ────────────────────
	reporter.startSuite('Discovery Panel UI (Smart Discovery)');
	try {
		// 0. Empty State Mounting (No Active File) to prevent effect_update_depth_exceeded regressions
		const tEmptyState = Date.now();
		const emptyStateCheck = await client.evaluate(`(async () => {
			// Close all markdown leaves to ensure activeFile is null
			app.workspace.getLeavesOfType('markdown').forEach(l => l.detach());
			
			// Open Chat View & switch to discovery tab
			app.commands.executeCommandById('lumina:open-chat');
			await new Promise(r => setTimeout(r, 500));
			
			const tabs = document.querySelectorAll('.lumina-sidebar__tab, .lumina-sidebar-tabs button');
			if (tabs.length > 1) tabs[1].click();
			
			await new Promise(r => setTimeout(r, 800)); // Wait for DiscoveryPanel to mount and settle
			
			const panel = document.querySelector('.lumina-discovery');
			const emptyState = document.querySelector('.lumina-discovery__empty');
			
			return {
				panelMounted: !!panel,
				emptyStateVisible: !!emptyState
			};
		})()`);

		reporter.record(
			'Empty State Mounts without Crash (No Active File)',
			emptyStateCheck.panelMounted && emptyStateCheck.emptyStateVisible,
			`Panel: ${emptyStateCheck.panelMounted}, EmptyState: ${emptyStateCheck.emptyStateVisible}`,
			Date.now() - tEmptyState
		);

		const tCtx = Date.now();
		// 1. Open active note to trigger Context Mode
		await client.evaluate(`(async () => {
			const testPath = '__lumina_discovery_e2e__.md';
			let file = app.vault.getAbstractFileByPath(testPath);
			if (!file) {
				file = await app.vault.create(testPath, '# 세계관\\n\\n테스트 연관 노트');
			}
			const leaf = app.workspace.getLeaf(true);
			await leaf.openFile(file);
			
			// Open Chat View
			app.commands.executeCommandById('lumina:open-chat');
			await new Promise(r => setTimeout(r, 300));
			
			// Switch to discovery tab
			const tabs = document.querySelectorAll('.lumina-sidebar__tab, .lumina-sidebar-tabs button');
			if (tabs.length > 1) tabs[1].click();
		})()`);

		await sleep(1500); // Wait for context search

		const contextCheck = await client.evaluate(`(() => {
			const panel = document.querySelector('.lumina-discovery');
			const contextView = document.querySelector('.lumina-discovery__context-view');
			return {
				panelMounted: !!panel,
				contextViewMounted: !!contextView
			};
		})()`);
		reporter.record('Active Note Context Mode', contextCheck.panelMounted && contextCheck.contextViewMounted, `Panel: ${contextCheck.panelMounted}, ContextView: ${contextCheck.contextViewMounted}`, Date.now() - tCtx);

		// 2. Search & Filter Reactivity
		const tSearch = Date.now();
		const searchCheck = await client.evaluate(`(async () => {
			const inputs = document.querySelectorAll('.lumina-discovery__search-input');
			if (inputs.length < 2) return { success: false, reason: 'Missing search inputs' };
			
			const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

			// Type in search query
			setter.call(inputs[0], '세계관');
			inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
			
			await new Promise(r => setTimeout(r, 1000)); // wait for 400ms debounce + search
			
			const results = document.querySelectorAll('.lumina-discovery__card');
			
			// Type in filter query with specific tag/text to verify active filtering
			setter.call(inputs[1], 'nonexistent_filter_tag_query');
			inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
			await new Promise(r => setTimeout(r, 600));
			const zeroFiltered = document.querySelectorAll('.lumina-discovery__card').length;

			// Clear filter query to restore results
			setter.call(inputs[1], '');
			inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
			await new Promise(r => setTimeout(r, 600));
			const restoredFiltered = document.querySelectorAll('.lumina-discovery__card').length;

			return {
				success: results.length > 0 && zeroFiltered <= results.length && restoredFiltered === results.length,
				resultCount: results.length,
				zeroFiltered,
				restoredFiltered,
			};
		})()`);
		reporter.record('Search & Filter Reactivity', searchCheck.success, `Search Results: ${searchCheck.resultCount}, Zero Filtered: ${searchCheck.zeroFiltered}, Restored: ${searchCheck.restoredFiltered}`, Date.now() - tSearch);

		// 2.5 Zero Results State Check
		const tZeroSearch = Date.now();
		const zeroCheck = await client.evaluate(`(async () => {
			const inputs = document.querySelectorAll('.lumina-discovery__search-input');
			if (inputs.length < 1) return { success: false, reason: 'Missing search input' };
			const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;

			const waitForSearchIdle = async (timeoutMs = 3500) => {
				// 400ms debounce 경과 대기 후 로딩/업데이트 표시가 끝날 때까지 폴링
				await new Promise(r => setTimeout(r, 550));
				const deadline = Date.now() + timeoutMs;
				while (Date.now() < deadline) {
					const isLoading = !!document.querySelector('.lumina-discovery__loading');
					const isUpdating = !!document.querySelector('.lumina-discovery__results-list.is-updating');
					if (!isLoading && !isUpdating) break;
					await new Promise(r => setTimeout(r, 100));
				}
			};
			
			// Type nonsensical query to get 0 results
			setter.call(inputs[0], '@@@@NOT_FOUND_QUERY_1234@@@@');
			inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
			await waitForSearchIdle();
			
			let results = document.querySelectorAll('.lumina-discovery__card');
			let emptyUI = document.querySelector('.lumina-discovery__empty');

			// 볼트 데이터/커스텀 임베딩 임계값에 따라 벡터 검색 결과가 남을 경우, 결정적 필터로 0건 빈 상태 검증
			if (results.length > 0 && inputs.length >= 2) {
				setter.call(inputs[1], '__lumina_nonexistent_filter_9999__');
				inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
				await waitForSearchIdle();
				results = document.querySelectorAll('.lumina-discovery__card');
				emptyUI = document.querySelector('.lumina-discovery__empty');

				setter.call(inputs[1], '');
				inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
				await new Promise(r => setTimeout(r, 100));
			}
			
			// Revert to normal search for next tests
			setter.call(inputs[0], '세계관');
			inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
			await waitForSearchIdle();
			
			return {
				success: results.length === 0,
				hasEmptyUI: !!emptyUI,
				resultCount: results.length
			};
		})()`);
		reporter.record('Zero Results Empty State', zeroCheck.success && zeroCheck.hasEmptyUI, `Results: ${zeroCheck.resultCount}, Empty UI: ${zeroCheck.hasEmptyUI}`, Date.now() - tZeroSearch);

		// 3. File-based Staging & Token Calculation
		const tStage = Date.now();
		const stageCheck = await client.evaluate(`(async () => {
			const card = document.querySelector('.lumina-discovery__card');
			if (!card) return { success: false, reason: 'No card' };
			
			// Dispatch mouseenter to reveal action buttons
			card.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
			await new Promise(r => setTimeout(r, 100)); // wait for svelte update
			
			const actionBtns = card.querySelectorAll('.lumina-discovery__action-btn');
			if (actionBtns.length === 0) return { success: false, reason: 'No action buttons' };
			
			const addBtn = actionBtns[actionBtns.length - 1];
			
			addBtn.click();
			await new Promise(r => setTimeout(r, 400)); // Wait for token calculation
			
			const stagedItems = document.querySelectorAll('.lumina-discovery__staging-chip');
			const stagingArea = document.querySelector('.lumina-discovery__staging-area');
			
			return {
				success: stagedItems.length > 0 && !!stagingArea,
				stagedCount: stagedItems.length
			};
		})()`);
		reporter.record('File-based Staging & Token Calculation', stageCheck.success, `Staged Items: ${stageCheck.stagedCount}`, Date.now() - tStage);

		// 4. State Preservation (Mount Persistence)
		const tPersist = Date.now();
		const persistCheck = await client.evaluate(`(async () => {
			const tabs = document.querySelectorAll('.lumina-sidebar-tabs button');
			if (tabs.length > 1) {
				tabs[0].click(); // Switch to Chat
				await new Promise(r => setTimeout(r, 200));
				tabs[1].click(); // Switch back to Discovery
				await new Promise(r => setTimeout(r, 200));
			}
			
			const inputs = document.querySelectorAll('.lumina-discovery__search-input');
			const stagedItems = document.querySelectorAll('.lumina-discovery__staging-chip');
			
			return {
				success: inputs[0]?.value === '세계관' && stagedItems.length > 0,
				preservedQuery: inputs[0]?.value
			};
		})()`);
		reporter.record('State Preservation (Mount Persistence)', persistCheck.success, `Preserved Query: ${persistCheck.preservedQuery}`, Date.now() - tPersist);

	} catch (err) {
		reporter.record('Discovery Panel UI (Smart Discovery)', false, err.message, 0);
	} finally {
		await client.evaluate(`(async () => {
			const activeLeaf = app.workspace.activeLeaf;
			if (activeLeaf && activeLeaf.view?.getViewType() === 'markdown') activeLeaf.detach();
			const file = app.vault.getAbstractFileByPath('__lumina_discovery_e2e__.md');
			if (file) await app.vault.delete(file);
		})()`);
		await sleep(200);
	}

	// ─── SUITE 6: Editor Extensions & Quick Actions ─────────────────────────
	reporter.startSuite('Editor & Quick Actions');
	try {
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
				app.workspace.setActiveLeaf(leaf, { focus: true });
				return { success: true, leafId: leaf.id };
			})()`);

			await sleep(500);

			const editorCheck = await client.evaluate(`(() => {
				const lumina = app.plugins.plugins['lumina'];
				const activeLeaf = app.workspace.activeLeaf;
				const editor = activeLeaf?.view?.editor || app.workspace.activeEditor?.editor;
				const hasQuickAction = !!lumina.quickActionHandler;
				return {
					hasEditor: !!editor,
					hasQuickAction
				};
			})()`);

			reporter.record('Active Note Opened in Editor', editorCheck.hasEditor, 'Test note opened in leaf', Date.now() - t0);
			reporter.record('Quick Action Handler Ready', editorCheck.hasQuickAction, 'Handler registered', Date.now() - t0);
		} catch (err) {
			reporter.record('Editor & Quick Actions', false, err.message, Date.now() - t0);
		}
	} finally {
		// Teardown: delete test note & close leaf
		await client.evaluate(`(async () => {
			const activeLeaf = app.workspace.activeLeaf;
			if (activeLeaf) activeLeaf.detach();
			const file = app.vault.getAbstractFileByPath('__lumina_e2e_test__.md');
			if (file) await app.vault.delete(file);
		})()`);
		await sleep(200);
	}

	// ─── SUITE 7: Frontmatter Strip Modal (Physical Keyboard Escape) ─────────
	reporter.startSuite('Frontmatter Tools (Modal UI & Keyboard Close)');
	{
		const t0 = Date.now();
		try {
			// Create a temporary Lumina-stamped file so the command opens the modal
			// (if count === 0, the command shows a Notice and returns without modal)
			// Use processFrontMatter to ensure metadataCache properly indexes the key
			await client.evaluate(`(async () => {
				const path = '__lumina_e2e_strip_test__.md';
				let file = app.vault.getAbstractFileByPath(path);
				if (!file) {
					file = await app.vault.create(path, '# Strip Test');
				}
				await app.fileManager.processFrontMatter(file, (fm) => {
					fm.luminaModified = true;
				});
				for (let i = 0; i < 30; i++) {
					const cache = app.metadataCache.getFileCache(file);
					if (cache?.frontmatter && 'luminaModified' in cache.frontmatter) break;
					await new Promise(r => setTimeout(r, 100));
				}
			})()`);
			await sleep(300);

			await client.evaluate(`app.commands.executeCommandById('lumina:strip-frontmatter-metadata')`);
			await sleep(500);

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

			// Re-open and actually trigger strip action to verify metadata removal
			const tStrip = Date.now();
			await client.evaluate(`app.commands.executeCommandById('lumina:strip-frontmatter-metadata')`);
			await sleep(500);

			const stripExecuted = await client.evaluate(`(async () => {
				const confirmBtn = document.querySelector('.modal-container button.mod-warning') || document.querySelector('.modal-container button.mod-cta') || document.querySelector('.modal-container button');
				if (confirmBtn) {
					confirmBtn.click();
					await new Promise(r => setTimeout(r, 600));
				}
				const path = '__lumina_e2e_strip_test__.md';
				const file = app.vault.getAbstractFileByPath(path);
				if (!file) return false;
				const content = await app.vault.read(file);
				return !content.includes('luminaModified');
			})()`);

			reporter.record(
				'Frontmatter Metadata Actually Stripped from Vault Note',
				stripExecuted,
				`Metadata stripped successfully: ${stripExecuted}`,
				Date.now() - tStrip
			);
		} catch (err) {
			reporter.record('Strip Modal Opened & Closed via Physical Escape Key', false, err.message, Date.now() - t0);
		}

		// Cleanup: remove temporary stamped file
		await client.evaluate(`(async () => {
			const file = app.vault.getAbstractFileByPath('__lumina_e2e_strip_test__.md');
			if (file) await app.vault.delete(file);
		})()`);
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

		// 3. Settings Reactive UI Effect Verification
		const t2 = Date.now();
		try {
			const toggleResult = await client.evaluate(`(() => {
				const lumina = app.plugins.plugins['lumina'];
				const orig = lumina.settings.misc.showRibbonIcon;
				const origGraph = lumina.settings.misc.showGraphRibbonIcon;

				// Clean up any pre-existing orphan ribbon elements not tracked by current plugin instance
				document.querySelectorAll(".side-dock-ribbon-action[aria-label*='Lumina']").forEach(el => {
					if (el !== lumina.ribbonEl && el !== lumina.graphRibbonEl) {
						el.detach();
					}
				});

				// 1. Turn off ribbon icons
				lumina.settings.misc.showRibbonIcon = false;
				lumina.settings.misc.showGraphRibbonIcon = false;
				lumina.updateRibbonIcon();
				const off = !document.querySelector(".side-dock-ribbon-action[aria-label*='Lumina']");

				// 2. Turn on chat ribbon icon
				lumina.settings.misc.showRibbonIcon = true;
				lumina.updateRibbonIcon();
				const on = !!document.querySelector(".side-dock-ribbon-action[aria-label*='Lumina']");

				// 3. Restore original settings
				lumina.settings.misc.showRibbonIcon = orig;
				lumina.settings.misc.showGraphRibbonIcon = origGraph;
				lumina.updateRibbonIcon();

				return { offWorked: off, restoreWorked: on };
			})()`);

			reporter.record(
				'Settings Reactive UI Update (Ribbon Toggle)',
				toggleResult.offWorked && toggleResult.restoreWorked,
				`Hidden on false: ${toggleResult.offWorked}, Restored on true: ${toggleResult.restoreWorked}`,
				Date.now() - t2
			);
		} catch (err) {
			reporter.record('Settings Reactive UI Update (Ribbon Toggle)', false, err.message, Date.now() - t2);
		}

		// 4. System Prompt Management & Settings Search Verification
		const t3 = Date.now();
		try {
			await client.evaluate(`(() => {
				app.setting.open();
				app.setting.openTabById('lumina');
			})()`);
			await sleep(400);

			const promptTestResult = await client.evaluate(`(async () => {
				const lumina = app.plugins.plugins['lumina'];
				const origPrompts = JSON.parse(JSON.stringify(lumina.settings.chat.systemPrompts || []));
				const origProjects = JSON.parse(JSON.stringify(lumina.settings.projects.list || []));
				const realTab = lumina.settingTab?.realTab;
				if (!realTab) return { success: false, reason: 'realTab not loaded' };

				try {
					// 1. Switch to Chat tab
					realTab.activeTab = 'chat';
					realTab.searchQuery = '';
					realTab.refreshDisplay(false);

					const container = realTab.containerEl;
					const getSysPromptCards = () => Array.from(
						container.querySelectorAll('.lumina-prompt-card')
					).filter(c => !!c.querySelector('input.lumina-prompt-card__name'));

					const initialCards = getSysPromptCards().length;

					// 2. Click "+ Add System Prompt" button -> verify auto-open
					const addBtn = container.querySelector('.lumina-settings-add-prompt-container button');
					if (!addBtn) return { success: false, reason: 'addBtn not found' };
					addBtn.click();
					await new Promise(r => setTimeout(r, 120));

					const cardsAfterAdd = getSysPromptCards();
					const newCard = cardsAfterAdd[cardsAfterAdd.length - 1];
					const autoOpened = cardsAfterAdd.length === initialCards + 1 && newCard?.open === true;

					// 3. Space key in summary nameInput should NOT toggle <details> closed & should live-sync dropdown
					const nameInput = newCard?.querySelector('input.lumina-prompt-card__name');
					if (!nameInput) return { success: false, reason: 'nameInput not found' };

					nameInput.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true, cancelable: true }));
					nameInput.dispatchEvent(new KeyboardEvent('keyup', { key: ' ', bubbles: true, cancelable: true }));
					const stayedOpenOnSpace = newCard.open === true;

					const testName = 'E2E Space Persona';
					nameInput.value = testName;
					nameInput.dispatchEvent(new Event('input', { bubbles: true }));

					const selectEl = container.querySelector('select[data-role="default-system-prompt-select"]');
					const dropdownSynced = selectEl
						? Array.from(selectEl.options).some(o => o.text === testName)
						: false;

					// 4. Settings search should match the system prompt card by name
					realTab.searchQuery = 'e2e space persona';
					realTab.refreshDisplay();
					const visibleCardsOnMatch = getSysPromptCards()
						.filter(c => c.style.display !== 'none');
					const searchMatched = visibleCardsOnMatch.length === 1;

					realTab.searchQuery = '';
					realTab.refreshDisplay();

					// 5. Delete all prompts -> verify default prompt auto-restored & project reference cleaned
					const addedId = lumina.settings.chat.systemPrompts[lumina.settings.chat.systemPrompts.length - 1]?.id;
					if (lumina.settings.projects.list[0] && addedId) {
						lumina.settings.projects.list[0].systemPromptId = addedId;
					}
					for (let guard = 0; guard < 10; guard++) {
						const sysCards = getSysPromptCards();
						const delBtn = sysCards[sysCards.length - 1]?.querySelector('.lumina-prompt-card__btn-delete');
						if (!delBtn) break;
						delBtn.click();
						await new Promise(r => setTimeout(r, 100));
						if (lumina.settings.chat.systemPrompts.length === 1 && lumina.settings.chat.systemPrompts[0].id === 'default') {
							break;
						}
					}
					const fallbackRestored = lumina.settings.chat.systemPrompts.length >= 1;
					const orphanCleaned = lumina.settings.projects.list[0]?.systemPromptId === '';

					return {
						success: autoOpened && stayedOpenOnSpace && dropdownSynced && searchMatched && fallbackRestored && orphanCleaned,
						autoOpened,
						stayedOpenOnSpace,
						dropdownSynced,
						searchMatched,
						fallbackRestored,
						orphanCleaned
					};
				} finally {
					lumina.settings.chat.systemPrompts = origPrompts;
					lumina.settings.projects.list = origProjects;
					await lumina.saveSettings();
					realTab.activeTab = 'connections';
					realTab.searchQuery = '';
					realTab.refreshDisplay(false);
				}
			})()`);

			await input.pressEscape();
			await sleep(250);

			reporter.record(
				'System Prompt Management & Settings Search',
				promptTestResult.success,
				promptTestResult.success
					? `AutoOpen: ${promptTestResult.autoOpened}, SpaceSafe: ${promptTestResult.stayedOpenOnSpace}, LiveSync: ${promptTestResult.dropdownSynced}, Search: ${promptTestResult.searchMatched}, Fallback: ${promptTestResult.fallbackRestored}`
					: `Failed: ${JSON.stringify(promptTestResult)}`,
				Date.now() - t3
			);
		} catch (err) {
			reporter.record('System Prompt Management & Settings Search', false, err.message, Date.now() - t3);
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
					success: !res?.isError && (text.includes('Tags in vault') || text.includes('#') || text.includes('No tags')),
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

				// RAG 포함 경로 설정이 있는 경우 허용된 하위 경로에 임시 노트를 생성
				const activeProj = lumina.settings.projects?.list?.find(p => p.id === lumina.settings.projects?.activeProjectId);
				const ragIncluded = (activeProj?.ragIncludedPaths || [])
					.map(p => (p || '').trim().replace(/\\\\/g, '/').replace(/^\\/+|\\/+$/g, ''))
					.filter(Boolean);
				const respectRag = lumina.settings.mcp?.agentRespectRagExclusions !== false;
				const baseFolder = respectRag && ragIncluded.length > 0 ? ragIncluded[0] : '';
				if (baseFolder) {
					let cur = '';
					for (const seg of baseFolder.split('/').filter(Boolean)) {
						cur = cur ? cur + '/' + seg : seg;
						if (!app.vault.getAbstractFileByPath(cur)) {
							await app.vault.createFolder(cur);
						}
					}
				}

				const tempPath = (baseFolder ? baseFolder + '/' : '') + '__lumina_search_test__.md';
				const existing = app.vault.getAbstractFileByPath(tempPath);
				if (existing) await app.vault.delete(existing, true);

				const token = '__lumina_e2e_search_token_' + Date.now() + '__';
				await app.vault.create(tempPath, '# Lumina MCP Search Test\\n\\n' + token);

				try {
					const start = Date.now();
					const res = await lumina.mcpManager.callTool(searchTool._serverId, 'search_notes', { query: token });
					const text = res?.content?.[0]?.text || '';
					return {
						success: !res?.isError && text.includes(tempPath) && (text.includes('발견됨') || text.includes('found') || text.includes('.md')),
						snippet: text.split('\\n')[0],
						duration: Date.now() - start
					};
				} finally {
					const tempFile = app.vault.getAbstractFileByPath(tempPath);
					if (tempFile) await app.vault.delete(tempFile, true);
				}
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

		// Test read_note tool (Success + Error Handling + RAG PathGuard Security Blocking)
		const t3 = Date.now();
		try {
			const readToolResult = await client.evaluate(`(async () => {
				const lumina = app.plugins.plugins['lumina'];
				const tools = lumina.mcpManager.getAllTools();
				const readTool = tools.find(t => t.name === 'read_note');
				if (!readTool) return { success: false, reason: 'no read_note tool' };

				const start = Date.now();
				// 1. Read existing note (select a note permitted by RAG/path exclusion settings)
				const files = app.vault.getMarkdownFiles();
				const pathGuard = lumina.mcpManager?.pathGuard ?? lumina.mcpManager?.localServer?.pathGuard;
				const cleanPrefix = (p) => (p || '').trim().replace(/\\\\/g, '/').replace(/^\\/+|\\/+$/g, '').toLowerCase();
				const historyRoot = cleanPrefix(lumina.settings.chat.historyPath) || 'chathistory';
				const activeProj = lumina.settings.projects?.list?.find(p => p.id === lumina.settings.projects?.activeProjectId);
				const ragExcluded = (activeProj?.ragExcludedPaths || []).map(cleanPrefix).filter(Boolean);
				const ragIncluded = (activeProj?.ragIncludedPaths || []).map(cleanPrefix).filter(Boolean);
				const isFallbackAllowed = (filePath) => {
					if (lumina.settings.mcp.agentRespectRagExclusions === false) return true;
					const lower = filePath.toLowerCase();
					const matchesPrefix = (prefix) => lower === prefix || lower.startsWith(prefix + '/');
					if (ragIncluded.length > 0 && !ragIncluded.some(matchesPrefix)) return false;
					const defaultExcluded = ['templates', '_templates', 'chathistory', 'backups', historyRoot];
					return !defaultExcluded.some(matchesPrefix) && !ragExcluded.some(matchesPrefix);
				};

				let candidate = files.find(f => {
					if (f.stat && f.stat.size === 0) return false;
					if (pathGuard && typeof pathGuard.isAgentPathAllowed === 'function') {
						return pathGuard.isAgentPathAllowed(f.path, lumina);
					}
					return isFallbackAllowed(f.path);
				});

				let targetPath = candidate?.path;
				let createdTemp = false;
				if (!targetPath) {
					targetPath = '__lumina_read_test__.md';
					await app.vault.create(targetPath, '# Lumina MCP Read Test\\nLine 2\\nLine 3');
					createdTemp = true;
				}

				// 2. Locate or create a note in an excluded path (verify RAG PathGuard security blocking)
				let excludedPath = files.find(f => {
					if (pathGuard && typeof pathGuard.isAgentPathAllowed === 'function') {
						return !pathGuard.isAgentPathAllowed(f.path, lumina);
					}
					return !isFallbackAllowed(f.path);
				})?.path;
				let createdExcludedTemp = false;
				if (!excludedPath && lumina.settings.mcp.agentRespectRagExclusions !== false) {
					const historyFolder = (lumina.settings.chat.historyPath || 'chatHistory').trim().replace(/\\\\/g, '/').replace(/^\\/+|\\/+$/g, '') || 'chatHistory';
					let cur = '';
					for (const seg of historyFolder.split('/').filter(Boolean)) {
						cur = cur ? cur + '/' + seg : seg;
						if (!app.vault.getAbstractFileByPath(cur)) {
							await app.vault.createFolder(cur);
						}
					}
					excludedPath = historyFolder + '/__lumina_excluded_test__.md';
					await app.vault.create(excludedPath, '# Excluded note');
					createdExcludedTemp = true;
				}

				try {
					// Test A: Normal note read
					const existRes = await lumina.mcpManager.callTool(readTool._serverId, 'read_note', { path: targetPath, endLine: 5 });
					const existText = existRes?.content?.[0]?.text || '';
					const existSuccess = !existRes?.isError && existText.length > 0;

					// Test B: Read non-existent note (verify not found error handling)
					const nonExistRes = await lumina.mcpManager.callTool(readTool._serverId, 'read_note', { path: '__non_existent_note_12345__.md' });
					const nonExistSuccess = nonExistRes?.isError === true;

					// Test C: Read excluded note (verify RAG PathGuard security blocks unauthorized path)
					let excludedSuccess = true;
					if (excludedPath && lumina.settings.mcp.agentRespectRagExclusions !== false) {
						const excludedRes = await lumina.mcpManager.callTool(readTool._serverId, 'read_note', { path: excludedPath });
						const excludedMsg = excludedRes?.content?.[0]?.text || '';
						excludedSuccess = excludedRes?.isError === true && (excludedMsg.includes('제한된 경로') || excludedMsg.toLowerCase().includes('restricted'));
					}

					return {
						success: existSuccess && nonExistSuccess && excludedSuccess,
						existSnippet: existText.split('\\n')[0],
						nonExistHandled: nonExistSuccess,
						excludedBlocked: excludedSuccess,
						duration: Date.now() - start
					};
				} finally {
					if (createdTemp) {
						const tempFile = app.vault.getAbstractFileByPath(targetPath);
						if (tempFile) await app.vault.delete(tempFile);
					}
					if (createdExcludedTemp) {
						const tempFile = app.vault.getAbstractFileByPath(excludedPath);
						if (tempFile) await app.vault.delete(tempFile);
					}
				}
			})()`);

			reporter.record(
				'Live Vault Note Read & Error Handling (read_note)',
				readToolResult.success,
				`Existing: "${readToolResult.existSnippet?.slice(0, 30)}...", NonExist: ${readToolResult.nonExistHandled}, ExcludedBlocked: ${readToolResult.excludedBlocked} (Latency: ${readToolResult.duration}ms)`,
				Date.now() - t3
			);
		} catch (err) {
			reporter.record('Live Vault Note Read & Error Handling (read_note)', false, err.message, Date.now() - t3);
		}

		// Test security guard: Read mode blocks mutating tools
		const tSecurity = Date.now();
		try {
			const guardResult = await client.evaluate(`(async () => {
				const lumina = app.plugins.plugins['lumina'];
				const origMode = lumina.settings.chat.agentExecutionMode;
				lumina.settings.chat.agentExecutionMode = 'read';

				const tools = lumina.mcpManager.getAllTools();
				const createTool = tools.find(t => t.name === 'create_note');
				if (!createTool) return { success: false, reason: 'no create_note tool' };

				const res = await lumina.mcpManager.callTool(createTool._serverId, 'create_note', {
					path: '__lumina_security_test__.md',
					content: 'test'
				});
				lumina.settings.chat.agentExecutionMode = origMode;

				const blocked = res?.isError === true && (res?.content?.[0]?.text || '').includes('수정 모드');
				return { success: blocked, reason: res?.content?.[0]?.text };
			})()`);

			reporter.record(
				'Security Guard: Read Mode Blocks Mutating Tools',
				guardResult.success,
				guardResult.success ? 'create_note blocked in read mode as expected' : `Failed: ${guardResult.reason}`,
				Date.now() - tSecurity
			);
		} catch (err) {
			reporter.record('Security Guard: Read Mode Blocks Mutating Tools', false, err.message, Date.now() - tSecurity);
		}

		// Test HITL Approval flow & mutating tool execution in edit mode
		const tHitl = Date.now();
		try {
			const hitlResult = await client.evaluate(`(async () => {
				const lumina = app.plugins.plugins['lumina'];
				const origMode = lumina.settings.chat.agentExecutionMode;
				lumina.settings.chat.agentExecutionMode = 'edit';

				// 1. Ensure chat leaf is open to receive approval UI card
				app.commands.executeCommandById('lumina:open-chat');
				await new Promise(r => setTimeout(r, 400));

				// 2. Invoke create_note asynchronously (it will await approval)
				const testPath = '__lumina_e2e_mcp_test__.md';
				const createTool = lumina.mcpManager.getAllTools().find(t => t.name === 'create_note');
				if (!createTool) return { success: false, reason: 'no create_note tool' };

				let toolFinished = false;
				let toolResult = null;
				lumina.mcpManager.callTool(createTool._serverId, 'create_note', {
					path: testPath,
					content: '# Lumina E2E Note\\nCreated by MCP tool'
				}).then(res => {
					toolFinished = true;
					toolResult = res;
				});

				// 3. Wait for approval card in UI
				let approved = false;
				for (let i = 0; i < 20; i++) {
					await new Promise(r => setTimeout(r, 100));
					const card = document.querySelector('.lumina-inline-approval-card');
					const acceptBtn = card?.querySelector('button.mod-cta');
					if (acceptBtn) {
						acceptBtn.click();
						approved = true;
						break;
					}
				}

				// 4. Wait for tool completion
				for (let i = 0; i < 20; i++) {
					if (toolFinished) break;
					await new Promise(r => setTimeout(r, 100));
				}

				// 5. Verify file was created in vault
				const file = app.vault.getAbstractFileByPath(testPath);
				const fileExists = !!file;
				let snippet = '';
				if (fileExists) {
					snippet = await app.vault.read(file);
					await app.vault.delete(file, true);
				}

				// 6. Restore settings & close chat leaf
				lumina.settings.chat.agentExecutionMode = origMode;
				app.workspace.getLeavesOfType('lumina-chat').forEach(l => l.detach());

				return {
					success: approved && fileExists && !toolResult?.isError,
					approved,
					fileExists,
					hasFrontmatter: snippet.includes('luminaCreated') || snippet.includes('Lumina')
				};
			})()`);

			reporter.record(
				'HITL Approval & Live Note Creation (create_note)',
				hitlResult.success,
				`Approval received: ${hitlResult.approved}, Vault file created: ${hitlResult.fileExists}, Stamped: ${hitlResult.hasFrontmatter}`,
				Date.now() - tHitl
			);
		} catch (err) {
			reporter.record('HITL Approval & Live Note Creation (create_note)', false, err.message, Date.now() - tHitl);
		} finally {
			// Guarantee cleanup of test file and leaf
			await client.evaluate(`(async () => {
				const p = '__lumina_e2e_mcp_test__.md';
				const f = app.vault.getAbstractFileByPath(p);
				if (f) await app.vault.delete(f, true);
				app.workspace.getLeavesOfType('lumina-chat').forEach(l => l.detach());
			})()`);
		}
	}

	// ─── SUITE 10: Live LLM Provider Test ────────────────────────────────────
	reporter.startSuite('Live LLM Provider (Short Prompt Test)');
	{
		const t0 = Date.now();
		try {
			const llmResult = await client.evaluate(`(async () => {
				const lumina = app.plugins.plugins['lumina'];
				const providers = lumina.settings.connections.providers || [];
				const activeId = lumina.settings.connections.activeProviderId;

				const req = window.requestUrl || (typeof require !== 'undefined' ? require('obsidian').requestUrl : null);
				if (!req) {
					return { success: false, providerType: 'unknown', error: 'Obsidian requestUrl API not available' };
				}

				const DEFAULT_BASE_URLS = {
					xai: 'https://api.x.ai',
					deepseek: 'https://api.deepseek.com',
					groq: 'https://api.groq.com/openai',
					openrouter: 'https://openrouter.ai/api',
					ollama: 'http://localhost:11434',
					lmstudio: 'http://localhost:1234',
				};

				const isCli = (type) => typeof type === 'string' && type.startsWith('cli-');
				const isLocalOrCustom = (type) => type === 'ollama' || type === 'lmstudio' || type === 'custom';

				// 활성 프로바이더 → 검증된 프로바이더 → 나머지 HTTP 프로바이더 순으로 시도 후보 정렬
				const sortedProviders = [...providers]
					.filter(p => !isCli(p.type))
					.sort((a, b) => {
						const aActive = a.id === activeId ? 0 : 1;
						const bActive = b.id === activeId ? 0 : 1;
						if (aActive !== bActive) return aActive - bActive;
						const aVerified = a.isVerified ? 0 : 1;
						const bVerified = b.isVerified ? 0 : 1;
						return aVerified - bVerified;
					});

				const candidates = [];
				for (const prov of sortedProviders) {
					const rawSecret = app.secretStorage?.getSecret('lumina-provider-' + prov.id) || prov.credential || '';
					const apiKey = rawSecret.trim();
					const rawBaseUrl = (prov.baseUrl || DEFAULT_BASE_URLS[prov.type] || '').trim();
					const baseUrl = rawBaseUrl.replace(/\\/+$/, '').replace(/\\/v1$/, '');

					if (isLocalOrCustom(prov.type)) {
						if (!baseUrl) continue;
						candidates.push({ prov, apiKey: apiKey || 'ollama', baseUrl });
					} else {
						if (!apiKey) continue;
						candidates.push({ prov, apiKey, baseUrl });
					}
				}

				if (candidates.length === 0) {
					return { skipped: true, reason: 'No HTTP LLM provider with valid credentials/URL configured' };
				}

				const testGoogle = async (prov, apiKey) => {
					const listRes = await req({
						url: 'https://generativelanguage.googleapis.com/v1beta/models',
						method: 'GET',
						headers: { 'x-goog-api-key': apiKey }
					});
					const models = listRes.json?.models || [];
					const geminiModels = models.filter(m => m.name && m.name.includes('gemini'));
					const preferred = (prov.availableModels || []).find(m => m.includes('flash')) || prov.availableModels?.[0];
					const candidateModel =
						preferred ||
						geminiModels.find(m => m.name.includes('gemini-2.5-flash') || m.name.includes('gemini-2.0-flash') || m.name.includes('flash'))?.name ||
						geminiModels[0]?.name ||
						'models/gemini-2.5-flash';
					const modelEndpoint = candidateModel.startsWith('models/') ? candidateModel.replace('models/', '') : candidateModel;

					const promptRes = await req({
						url: 'https://generativelanguage.googleapis.com/v1beta/models/' + modelEndpoint + ':generateContent',
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'x-goog-api-key': apiKey
						},
						body: JSON.stringify({
							contents: [{ role: 'user', parts: [{ text: 'Say "PONG" and nothing else.' }] }],
							generationConfig: { maxOutputTokens: 100 }
						})
					});
					const text = promptRes.json?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
					return { testModel: modelEndpoint, response: text };
				};

				const testAnthropic = async (prov, apiKey) => {
					let modelId = (prov.availableModels || [])[0];
					if (!modelId) {
						const listRes = await req({
							url: 'https://api.anthropic.com/v1/models',
							method: 'GET',
							headers: {
								'x-api-key': apiKey,
								'anthropic-version': '2023-06-01'
							}
						});
						const models = (listRes.json?.data || []).map(m => m.id).filter(id => id && id.startsWith('claude-'));
						modelId = models.find(id => id.includes('haiku')) || models[0] || 'claude-3-5-haiku-latest';
					}
					const promptRes = await req({
						url: 'https://api.anthropic.com/v1/messages',
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							'x-api-key': apiKey,
							'anthropic-version': '2023-06-01'
						},
						body: JSON.stringify({
							model: modelId,
							max_tokens: 100,
							messages: [{ role: 'user', content: 'Say "PONG" and nothing else.' }]
						})
					});
					const textBlock = (promptRes.json?.content || []).find(c => c.type === 'text');
					return { testModel: modelId, response: (textBlock?.text || '').trim() };
				};

				const testOpenAICompat = async (prov, apiKey, baseUrl) => {
					const resolvedBase = prov.type === 'openai' ? 'https://api.openai.com' : baseUrl;
					let modelId = (prov.availableModels || [])[0];
					if (!modelId) {
						if (prov.type === 'ollama') {
							const listRes = await req({ url: resolvedBase + '/api/tags', method: 'GET' });
							modelId = listRes.json?.models?.[0]?.name || '';
						} else {
							const listRes = await req({
								url: resolvedBase + '/v1/models',
								method: 'GET',
								headers: { Authorization: 'Bearer ' + apiKey }
							});
							const list = Array.isArray(listRes.json) ? listRes.json : (listRes.json?.data || listRes.json?.models || []);
							modelId = list.map(m => m?.id || m?.name).find(Boolean) || '';
						}
					}
					if (!modelId) throw new Error('No available model found');

					const isReasoningModel = /^(o\\d|gpt-5)/i.test(modelId);
					const bodyPayload = {
						model: modelId,
						messages: [{ role: 'user', content: 'Say "PONG" and nothing else.' }],
						...(isReasoningModel ? { max_completion_tokens: 100 } : { max_tokens: 100 })
					};
					const promptRes = await req({
						url: resolvedBase + '/v1/chat/completions',
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
							Authorization: 'Bearer ' + apiKey
						},
						body: JSON.stringify(bodyPayload)
					});
					const text = promptRes.json?.choices?.[0]?.message?.content?.trim() || '';
					return { testModel: modelId, response: text };
				};

				const failedAttempts = [];
				for (const { prov, apiKey, baseUrl } of candidates) {
					const start = Date.now();
					try {
						let out;
						if (prov.type === 'google') {
							out = await testGoogle(prov, apiKey);
						} else if (prov.type === 'anthropic') {
							out = await testAnthropic(prov, apiKey);
						} else {
							out = await testOpenAICompat(prov, apiKey, baseUrl);
						}
						return {
							success: true,
							providerType: prov.type,
							testModel: out.testModel,
							response: out.response,
							latency: Date.now() - start,
							failedAttempts
						};
					} catch (e) {
						const msg = e?.message || String(e);
						failedAttempts.push('[' + prov.type + '] ' + msg);
					}
				}

				return {
					success: false,
					providerType: candidates[0].prov.type,
					error: failedAttempts.join(' | ')
				};
			})()`, 45000);

			if (llmResult.skipped) {
				reporter.recordSkip('Live LLM Provider Completion', `Skipped: ${llmResult.reason}`, Date.now() - t0);
			} else if (llmResult.success) {
				const fallbackNote = llmResult.failedAttempts?.length
					? ` (fallback after: ${llmResult.failedAttempts.join('; ')})`
					: '';
				reporter.record('Live LLM Provider Completion', true, `[${llmResult.providerType}] Model: ${llmResult.testModel}, Output: "${llmResult.response}", Latency: ${llmResult.latency}ms${fallbackNote}`, Date.now() - t0);
			} else {
				reporter.record('Live LLM Provider Completion', false, `All providers failed: ${llmResult.error}`, Date.now() - t0);
			}
		} catch (err) {
			reporter.record('Live LLM Provider Completion', false, err.message, Date.now() - t0);
		}
	}

	// ─── SUITE 11~14: Pro Entitlement Gate, Freemium Preview, Split, Batch & Voice Suites ───
	try {
		await runAllProSuites(client, input, reporter, mockServer, { requiredMode });
		await runMobileSuite(client, input, reporter, mockServer, { requiredMode });
		return reporter.summary();
	} finally {
		await cleanupProArtifacts(client).catch(() => {});
		await mockServer.close().catch(() => {});
		client.close();
	}
}

/**
 * Pro 권한 게이트 감지 결과에 따라 Desktop Pro 또는 Freemium Preview 스위트를 실행합니다.
 */
async function runAllProSuites(client, input, reporter, mockServer, options = {}) {
	const { mode } = await runProEntitlementGateSuite(client, input, reporter, {
		requiredMode: options.requiredMode ?? null,
	});

	if (mode === 'freemium-preview') {
		await runFreemiumPreviewSuite(client, input, reporter, mockServer);
	} else if (mode === 'pro-active') {
		await runSplitChatProSuite(client, input, reporter, mockServer);
		await runBatchStudioProSuite(client, input, reporter, mockServer);
		await runVoiceToNoteProSuite(client, input, reporter, mockServer);
	}
}

/**
 * SUITE 15: 모바일 환경 에뮬레이션 및 호환성 검증 스위트
 * - CDP 모바일 뷰포트(390x844) + 터치 에뮬레이션
 * - Platform.isMobile = true 전환 및 Node.js 전용 모듈(path, http, child_process 등) require 차단 상태에서 콜드 부팅
 * - 모바일 설정 탭(로컬/CLI 프로바이더 필터링, RAG 클라우드 임베딩 선택기 노출, MCP 로컬/외부 서버 숨김)
 * - 모바일 채팅 뷰(MCP 팝업 데스크탑 항목 숨김, .is-mobile 터치 액션 버튼 상시 노출)
 */
async function runMobileSuite(client, input, reporter, mockServer, options = {}) {
	reporter.startSuite('Mobile Environment Emulation & Compatibility');
	const tMobileStart = Date.now();

	try {
		// 1. CDP 모바일 뷰포트 및 터치 에뮬레이션 활성화
		await client.send('Emulation.setDeviceMetricsOverride', {
			width: 390,
			height: 844,
			deviceScaleFactor: 3,
			mobile: true,
		});
		await client.send('Emulation.setTouchEmulationEnabled', {
			enabled: true,
			maxTouchPoints: 5,
		});

		// 2. 모바일 모드 전환 + Node.js built-in require 차단 훅 + 플러그인 콜드 리로드
		const tBoot = Date.now();
		const bootResult = await client.evaluate(`(async () => {
			// 원본 상태 백업 (window.__luminaMobileE2EBackup)
			const luminaBefore = app.plugins.plugins['lumina'];
			const manifestObj = app.plugins.manifests['lumina'];
			const adapter = app.vault.adapter;
			const origAdapterRead = adapter.read.bind(adapter);
			const origAdapterGetBasePath = typeof adapter.getBasePath === 'function' ? adapter.getBasePath.bind(adapter) : null;

			window.__luminaMobileE2EBackup = {
				appIsMobile: app.isMobile,
				manifestIsDesktopOnly: manifestObj ? manifestObj.isDesktopOnly : true,
				leftSplitCollapsed: Boolean(app.workspace.leftSplit?.collapsed),
				rightSplitCollapsed: Boolean(app.workspace.rightSplit?.collapsed),
				bodyClasses: {
					isMobile: document.body.classList.contains('is-mobile'),
					isPhone: document.body.classList.contains('is-phone'),
					isDesktop: document.body.classList.contains('is-desktop'),
				},
				origRequire: window.require,
				origAdapterRead,
				origAdapterGetBasePath,
				settingsJson: luminaBefore ? JSON.stringify(luminaBefore.settings) : null,
			};

			// 플러그인 언로드
			if (app.plugins.enabledPlugins.has('lumina')) {
				await app.plugins.disablePlugin('lumina');
				await new Promise(r => setTimeout(r, 200));
			}

			// require.cache에서 lumina 번들 제거
			if (window.require && window.require.cache) {
				for (const k of Object.keys(window.require.cache)) {
					if (k.includes('obsidian-lumina') || k.includes('plugins/lumina')) {
						delete window.require.cache[k];
					}
				}
			}

			// 이전 빌드에서 남아 있는 Lumina Svelte 스타일 태그를 제거하여 새 번들의 CSS가 정상 주입되도록 보장
			document.head.querySelectorAll('style[id^="svelte-"]').forEach((el) => {
				if ((el.textContent || '').includes('lumina-')) el.remove();
			});

			// app 및 body 클래스를 모바일로 전환 (manifest.isDesktopOnly도 메모리에서 임시 해제)
			window.__luminaForceMobilePlatform = true;
			app.isMobile = true;
			if (manifestObj) manifestObj.isDesktopOnly = false;
			document.body.classList.remove('is-desktop');
			document.body.classList.add('is-mobile', 'is-phone');
			// 데스크탑 Obsidian DOM에는 WorkspaceMobile의 .mod-visible 관리자가 없으므로
			// 모바일 에뮬레이션 동안 활성 rootSplit 탭 컨테이너만 표시되도록 임시 스타일 주입 (finally에서 제거)
			let mobileCompatStyle = document.getElementById('__lumina-mobile-e2e-compat__');
			if (!mobileCompatStyle) {
				mobileCompatStyle = document.createElement('style');
				mobileCompatStyle.id = '__lumina-mobile-e2e-compat__';
				mobileCompatStyle.textContent = 'body.is-phone .mod-root .workspace-tabs.mod-active { display: flex !important; }';
				document.head.appendChild(mobileCompatStyle);
			}

			// 이미 로드된 __luminaObsidianMod가 있으면 즉시 Platform도 모바일로 전환
			if (window.__luminaObsidianMod && window.__luminaObsidianMod.Platform) {
				const p = window.__luminaObsidianMod.Platform;
				if (!window.__luminaOrigPlatform) {
					window.__luminaOrigPlatform = {
						isMobile: p.isMobile,
						isDesktop: p.isDesktop,
						isDesktopApp: p.isDesktopApp,
						isMobileApp: p.isMobileApp,
						isPhone: p.isPhone,
						isIosApp: p.isIosApp,
					};
				}
				Object.defineProperty(p, 'isMobile', { value: true, configurable: true, writable: true });
				Object.defineProperty(p, 'isDesktop', { value: false, configurable: true, writable: true });
				Object.defineProperty(p, 'isDesktopApp', { value: false, configurable: true, writable: true });
				Object.defineProperty(p, 'isMobileApp', { value: true, configurable: true, writable: true });
				Object.defineProperty(p, 'isPhone', { value: true, configurable: true, writable: true });
				Object.defineProperty(p, 'isIosApp', { value: true, configurable: true, writable: true });
			}

			// Obsidian eval 소스(# sourceURL=plugin:lumina) 및 경로 기반 스택 프레임 판별
			const isFromLuminaStack = (stack) => {
				return stack.includes('plugin:lumina')
					|| stack.includes('plugins/lumina')
					|| stack.includes('obsidian-lumina')
					|| stack.includes('eval at loadPlugin');
			};
			window.__luminaMobileE2EIsFromLuminaStack = isFromLuminaStack;

			// CapacitorAdapter(모바일) 환경 시뮬레이션: Lumina 스택에서의 getBasePath 호출만 차단·기록
			const blockedGetBasePathCalls = [];
			window.__luminaMobileE2EBlockedGetBasePath = blockedGetBasePathCalls;
			if (origAdapterGetBasePath) {
				adapter.getBasePath = function() {
					const stack = (new Error().stack || '');
					if (isFromLuminaStack(stack)) {
						blockedGetBasePathCalls.push(stack.split('\\n')[1]?.trim() || 'lumina');
						throw new Error('Mobile WebView simulation: FileSystemAdapter.getBasePath is not available');
					}
					return origAdapterGetBasePath();
				};
			}

			// Node.js / Electron 전용 모듈 require 차단 훅 설치 (Lumina 번들에서 호출 시 기록 및 예외 발생)
			const origReq = window.__luminaMobileE2EBackup.origRequire;
			const blockedModules = new Set([
				'path', 'node:path',
				'child_process', 'node:child_process',
				'http', 'node:http',
				'https', 'node:https',
				'http2', 'node:http2',
				'net', 'node:net',
				'crypto', 'node:crypto',
				'stream', 'node:stream',
				'fs', 'node:fs',
				'os', 'node:os',
				'buffer', 'node:buffer',
				'util', 'node:util',
				'zlib', 'node:zlib',
				'url', 'node:url',
				'events', 'node:events',
				'electron', 'node:electron',
				'worker_threads', 'node:worker_threads',
				'perf_hooks', 'node:perf_hooks',
				'tty', 'node:tty',
				'dns', 'node:dns',
				'tls', 'node:tls',
			]);
			const blockedCalls = [];
			window.__luminaMobileE2EBlockedRequire = blockedCalls;
			const hookedRequire = function(modId) {
				if (blockedModules.has(modId)) {
					const stack = (new Error().stack || '');
					if (isFromLuminaStack(stack)) {
						blockedCalls.push(modId);
						throw new Error('Mobile WebView simulation: Node module "' + modId + '" is not available');
					}
				}
				return origReq.apply(this, arguments);
			};
			Object.assign(hookedRequire, origReq);
			hookedRequire.cache = origReq.cache;
			hookedRequire.resolve = origReq.resolve;
			window.require = hookedRequire;

			// 훅 셀프 체크: plugin:lumina 스택 매칭 및 차단 예외 동작 확인 후 카운터 초기화
			const hookSelfCheckOk = Boolean(
				isFromLuminaStack('at load (plugin:lumina:1:1)') &&
				(() => {
					try {
						const fn = new Function('return window.require("child_process");//# sourceURL=plugin:lumina');
						fn();
						return false;
					} catch {
						return blockedCalls.length > 0;
					}
				})()
			);
			blockedCalls.length = 0;
			blockedGetBasePathCalls.length = 0;

			// 모바일 상태에서 Lumina 콜드 부팅
			await app.plugins.enablePlugin('lumina');
			await new Promise(r => setTimeout(r, 600));

			const lumina = app.plugins.plugins['lumina'];
			const Platform = window.__luminaObsidianMod?.Platform;
			const isMobileFlag = Boolean(Platform && Platform.isMobile && !Platform.isDesktop);
			const prevAgentEnabled = lumina?.settings?.chat?.agentEnabled;
			if (lumina?.settings?.chat) {
				lumina.settings.chat.agentEnabled = true;
			}
			const tools = lumina?.mcpManager?.getAllTools?.() || [];
			if (lumina?.settings?.chat && prevAgentEnabled !== undefined) {
				lumina.settings.chat.agentEnabled = prevAgentEnabled;
			}
			const hasBuiltInTools = tools.length > 0;
			const hasShellTool = tools.some(t => t.name === 'run_shell_command');
			const localHttpServerStopped = !lumina?.mcpManager?.localServer;

			return {
				loaded: !!lumina,
				isMobileFlag,
				hookSelfCheckOk,
				platformHookMissing: !isMobileFlag,
				blockedCalls,
				blockedGetBasePathCalls,
				localHttpServerStopped,
				hasBuiltInTools,
				hasShellTool,
				toolCount: tools.length,
			};
		})()`);

		reporter.record(
			'Mobile Cold Boot, Zero Node.js Require & Built-in Agent Tool Filtering',
			bootResult.loaded &&
				bootResult.isMobileFlag &&
				bootResult.hookSelfCheckOk &&
				bootResult.blockedCalls.length === 0 &&
				bootResult.blockedGetBasePathCalls.length === 0 &&
				bootResult.localHttpServerStopped &&
				bootResult.hasBuiltInTools &&
				!bootResult.hasShellTool,
			bootResult.platformHookMissing
				? 'Platform hook missing (build with npm run build:dev or LUMINA_MOBILE_TEST=true npm run build)'
				: `Loaded: ${bootResult.loaded}, HookSelfCheck: ${bootResult.hookSelfCheckOk}, BlockedNodeRequires: ${bootResult.blockedCalls.length}, BlockedGetBasePath: ${bootResult.blockedGetBasePathCalls.length}, LocalHTTP: ${!bootResult.localHttpServerStopped ? 'running(ERR)' : 'stopped(OK)'}, Tools: ${bootResult.toolCount} (shell=${bootResult.hasShellTool})`,
			Date.now() - tBoot
		);

		// 3. 모바일 설정 탭 검증 (로컬/CLI 프로바이더 제외, RAG 클라우드 임베딩 선택기 노출, MCP 로컬/외부 서버 숨김)
		const tSettings = Date.now();
		const settingsResult = await client.evaluate(`(async () => {
			const lumina = app.plugins.plugins['lumina'];
			const origProviders = JSON.parse(JSON.stringify(lumina.settings.connections.providers || []));
			const origRagEnabled = lumina.settings.connections.ragEnabled;
			const origEmbedding = JSON.parse(JSON.stringify(lumina.settings.connections.embedding));

			try {
				if (lumina.settings.connections.providers.length === 0) {
					lumina.settings.connections.providers.push({
						id: '__mobile_e2e_temp_provider__',
						type: 'openai',
						credential: '',
						availableModels: ['text-embedding-3-small'],
						isVerified: true,
					});
				}
				lumina.settings.connections.ragEnabled = false;
				lumina.settings.connections.embedding = { mode: 'auto', providerId: '', modelId: '' };

				app.setting.open();
				app.setting.openTabById('lumina');
				const deadline = Date.now() + 3000;
				while (Date.now() < deadline) {
					if (document.querySelector('.lumina-settings__nav-btn')) break;
					await new Promise(r => setTimeout(r, 100));
				}
				await new Promise(r => setTimeout(r, 200));

				const container = app.setting.activeTab?.containerEl;
				const initNavBtns = Array.from(container?.querySelectorAll('.lumina-settings__nav-btn:not(.lumina-settings__nav-btn--advanced)') || []);
				if (initNavBtns[0] && !initNavBtns[0].classList.contains('is-active')) {
					initNavBtns[0].click();
					await new Promise(r => setTimeout(r, 200));
				}
				const providerSelect = container?.querySelector('.lumina-provider-card__setting-type select');
				const optionValues = Array.from(providerSelect?.options || []).map(o => o.value);
				const forbiddenTypes = ['ollama', 'lmstudio', 'cli-claude-code', 'cli-codex', 'cli-opencode', 'cli-antigravity'];
				const hasForbiddenProvider = optionValues.some(v => forbiddenTypes.includes(v));

				// 고급 설정 활성화 시 ragEnabled=false(모바일 auto 잠금) 상태에서도 클라우드 임베딩 선택기가 노출되는지 확인
				const advBtn = container?.querySelector('.lumina-settings__nav-btn--advanced');
				if (advBtn && !advBtn.classList.contains('is-active')) {
					advBtn.click();
					await new Promise(r => setTimeout(r, 200));
				}
				const warningBoxes = container?.querySelectorAll('.lumina-settings__info-box--warning') || [];
				const hasEmbeddingSelectorInAdvanced = warningBoxes.length >= 3;

				// MCP 탭 전환 → 모바일에서는 내장 에이전트 섹션(헤딩 1개)만 노출되고 로컬/외부 서버는 숨겨져야 함
				const navBtns = Array.from(container?.querySelectorAll('.lumina-settings__nav-btn:not(.lumina-settings__nav-btn--advanced)') || []);
				const mcpTabBtn = navBtns[3]; // connections(0), chat(1), rag(2), mcp(3)
				mcpTabBtn?.click();
				await new Promise(r => setTimeout(r, 200));

				const mcpHeadings = container?.querySelectorAll('.lumina-settings__section-heading') || [];
				const mcpAddServerCta = container?.querySelector('.lumina-setting-cta');
				const mcpMobileIsolated = mcpHeadings.length === 1 && !mcpAddServerCta;

				return {
					success: optionValues.length > 0 && !hasForbiddenProvider && hasEmbeddingSelectorInAdvanced && mcpMobileIsolated,
					optionCount: optionValues.length,
					hasForbiddenProvider,
					hasEmbeddingSelectorInAdvanced,
					warningCount: warningBoxes.length,
					mcpHeadingsCount: mcpHeadings.length,
					mcpMobileIsolated,
				};
			} finally {
				lumina.settings.connections.providers = origProviders;
				lumina.settings.connections.ragEnabled = origRagEnabled;
				lumina.settings.connections.embedding = origEmbedding;
				app.setting.close();
				// 모바일 모달 닫힘 애니메이션 완료까지 대기
				const closeDeadline = Date.now() + 1500;
				while (Date.now() < closeDeadline) {
					if (!document.querySelector('.modal-container')) break;
					await new Promise(r => setTimeout(r, 50));
				}
			}
		})()`);

		reporter.record(
			'Mobile Settings: Local/CLI Filtered, RAG Cloud Selector Accessible & MCP Tab Isolated',
			settingsResult.success,
			`CloudOptions: ${settingsResult.optionCount} (forbidden=${settingsResult.hasForbiddenProvider}), RAGSelectorVisible: ${settingsResult.hasEmbeddingSelectorInAdvanced} (warnings=${settingsResult.warningCount}), MCPHeadings: ${settingsResult.mcpHeadingsCount}`,
			Date.now() - tSettings
		);

		// 3-B. Synced Vault Resilience & Mobile Settings Responsive Overflow 검증
		const tSyncedSettings = Date.now();
		const syncedSettingsResult = await client.evaluate(`(async () => {
			const lumina = app.plugins.plugins['lumina'];
			const origProviders = JSON.parse(JSON.stringify(lumina.settings.connections.providers || []));
			const origRagEnabled = lumina.settings.connections.ragEnabled;
			const origEmbedding = JSON.parse(JSON.stringify(lumina.settings.connections.embedding));

			try {
				lumina.settings.connections.providers = [
					{
						id: '__sync_ollama__',
						type: 'ollama',
						credential: '',
						availableModels: ['llama3'],
						isVerified: true,
					},
					{
						id: '__sync_cli__',
						type: 'cli-claude-code',
						credential: '',
						availableModels: ['claude-sonnet-4'],
						isVerified: true,
					},
					{
						id: '__sync_openai_missing_key__',
						type: 'openai',
						credential: '',
						availableModels: ['gpt-4o'],
						isVerified: true,
					},
				];
				lumina.settings.connections.ragEnabled = true;
				lumina.settings.connections.embedding = { mode: 'auto', providerId: '', modelId: '' };
				await lumina.saveSettings();

				app.setting.open();
				app.setting.openTabById('lumina');
				const navDeadline = Date.now() + 3000;
				while (Date.now() < navDeadline) {
					if (document.querySelector('.lumina-settings__nav-btn')) break;
					await new Promise(r => setTimeout(r, 100));
				}
				const container = app.setting.activeTab?.containerEl;
				const navBtns = Array.from(container?.querySelectorAll('.lumina-settings__nav-btn:not(.lumina-settings__nav-btn--advanced)') || []);
				if (navBtns[0] && !navBtns[0].classList.contains('is-active')) {
					navBtns[0].click();
				}
				const deadline = Date.now() + 3000;
				while (Date.now() < deadline) {
					if (container?.querySelector('.lumina-provider-card')) break;
					await new Promise(r => setTimeout(r, 100));
				}
				await new Promise(r => setTimeout(r, 250));
				const desktopOnlyCards = container?.querySelectorAll('.lumina-provider-card.is-desktop-only-mobile').length || 0;
				const missingKeyCards = container?.querySelectorAll('.lumina-provider-card.is-missing-key').length || 0;
				const ragPreserved = lumina.settings.connections.ragEnabled === true;

				const cs = container ? getComputedStyle(container) : null;
				const padLeft = cs ? parseFloat(cs.paddingLeft || '0') : 999;
				const padRight = cs ? parseFloat(cs.paddingRight || '0') : 999;
				const noHorizontalOverflow = container ? container.scrollWidth <= container.clientWidth + 4 : false;
				const compactPadding = padLeft <= 20 && padRight <= 20;
				const offenders = [];
				if (container && !noHorizontalOverflow) {
					const cRect = container.getBoundingClientRect();
					for (const child of Array.from(container.querySelectorAll('*'))) {
						const r = child.getBoundingClientRect();
						if (r.right > cRect.right + 2) {
							offenders.push(String(child.tagName).toLowerCase() + '.' + String(child.className || '').trim().split(/\\s+/).slice(0, 2).join('.') + '=' + Math.round(r.right) + '/' + Math.round(r.width));
							if (offenders.length >= 3) break;
						}
					}
				}

				return {
					success: ragPreserved && desktopOnlyCards === 2 && missingKeyCards === 1 && noHorizontalOverflow && compactPadding,
					ragPreserved,
					desktopOnlyCards,
					missingKeyCards,
					noHorizontalOverflow,
					padLeft,
					padRight,
					scrollWidth: container?.scrollWidth ?? -1,
					clientWidth: container?.clientWidth ?? -1,
					offenders,
				};
			} finally {
				lumina.settings.connections.providers = origProviders;
				lumina.settings.connections.ragEnabled = origRagEnabled;
				lumina.settings.connections.embedding = origEmbedding;
				await lumina.saveSettings();
				app.setting.close();
				// 모바일 모달 닫힘 애니메이션 완료까지 대기
				const closeDeadline = Date.now() + 1500;
				while (Date.now() < closeDeadline) {
					if (!document.querySelector('.modal-container')) break;
					await new Promise(r => setTimeout(r, 50));
				}
			}
		})()`);

		reporter.record(
			'Mobile Synced Vault Resilience & Settings Responsive Overflow',
			syncedSettingsResult.success,
			`ragPreserved=${syncedSettingsResult.ragPreserved}, desktopOnlyCards=${syncedSettingsResult.desktopOnlyCards}, missingKeyCards=${syncedSettingsResult.missingKeyCards}, overflowOK=${syncedSettingsResult.noHorizontalOverflow} (${syncedSettingsResult.scrollWidth}/${syncedSettingsResult.clientWidth}), pad=(${syncedSettingsResult.padLeft},${syncedSettingsResult.padRight})${syncedSettingsResult.offenders?.length ? `, offenders=[${syncedSettingsResult.offenders.join(', ')}]` : ''}`,
			Date.now() - tSyncedSettings
		);

		// 3-C. Mobile ChatTab(자동완성 잠금+원본보존) & RagTab(모바일 경고+프로젝트 전환 무오류) 검증
		const tChatRagTabs = Date.now();
		const chatRagTabsResult = await client.evaluate(`(async () => {
			const lumina = app.plugins.plugins['lumina'];
			const origChatEnableAutocomplete = lumina.settings.chat.enableAutocomplete;
			const origTaskProviderId = lumina.settings.connections.taskProviderId;
			const origTaskModelId = lumina.settings.connections.taskModelId;
			const origProviders = JSON.parse(JSON.stringify(lumina.settings.connections.providers || []));
			const origRagEnabled = lumina.settings.connections.ragEnabled;
			const origEmbedding = JSON.parse(JSON.stringify(lumina.settings.connections.embedding));
			const origProjects = JSON.parse(JSON.stringify(lumina.settings.projects.list || []));
			const origActiveProj = lumina.settings.projects.activeProjectId;

			try {
				lumina.settings.connections.providers = [{
					id: '__mobile_chat_rag_prov__',
					type: 'openai',
					credential: 'sk-test',
					availableModels: ['gpt-4o-mini'],
					isVerified: true,
				}];
				lumina.settings.connections.taskProviderId = '__mobile_chat_rag_prov__';
				lumina.settings.connections.taskModelId = 'gpt-4o-mini';
				lumina.settings.chat.enableAutocomplete = true;
				lumina.settings.connections.ragEnabled = true;
				lumina.settings.connections.embedding = { mode: 'auto', providerId: '', modelId: '' };
				if (!lumina.settings.projects.list.some(p => p.id === '__mobile_e2e_proj__')) {
					lumina.settings.projects.list.push({
						id: '__mobile_e2e_proj__',
						name: 'Mobile E2E Project',
						historySubfolder: '',
						ragIncludedPaths: [],
						ragExcludedPaths: [],
					});
				}
				await lumina.saveSettings();

				app.setting.open();
				app.setting.openTabById('lumina');
				const navDeadline = Date.now() + 3000;
				while (Date.now() < navDeadline) {
					if (document.querySelector('.lumina-settings__nav-btn')) break;
					await new Promise(r => setTimeout(r, 100));
				}
				await new Promise(r => setTimeout(r, 200));

				const container = app.setting.activeTab?.containerEl;
				const navBtns = Array.from(container?.querySelectorAll('.lumina-settings__nav-btn:not(.lumina-settings__nav-btn--advanced)') || []);
				// Chat 탭(index 1)
				navBtns[1]?.click();
				await new Promise(r => setTimeout(r, 200));
				const chatText = container?.textContent || '';
				const chatTabNoOverflow = container ? container.scrollWidth <= container.clientWidth + 4 : false;
				const subSettingsHidden = !chatText.includes('Autocomplete Prompt');
				const originalAutocompletePreserved = lumina.settings.chat.enableAutocomplete === true;

				// Rag 탭(index 2)
				navBtns[2]?.click();
				await new Promise(r => setTimeout(r, 200));
				const ragWarnings = container?.querySelectorAll('.lumina-settings__info-box--warning')?.length || 0;
				const ragTabNoOverflow = container ? container.scrollWidth <= container.clientWidth + 4 : false;

				// 프로젝트 전환 버튼 클릭 시 모바일 auto 상태에서 에러 없이 전환되고 indexer를 띄우지 않아야 함
				const activateBtns = Array.from(container?.querySelectorAll('.lumina-feature-card button') || [])
					.filter(b => b.textContent?.trim() && !b.querySelector('svg'));
				let switchCompleted = false;
				if (activateBtns.length > 0) {
					activateBtns[activateBtns.length - 1].click();
					await new Promise(r => setTimeout(r, 250));
					switchCompleted = !lumina.indexer;
				} else {
					switchCompleted = !lumina.indexer;
				}

				return {
					success: chatTabNoOverflow && subSettingsHidden && originalAutocompletePreserved && ragWarnings >= 1 && ragTabNoOverflow && switchCompleted,
					chatTabNoOverflow,
					subSettingsHidden,
					originalAutocompletePreserved,
					ragWarnings,
					ragTabNoOverflow,
					switchCompleted,
				};
			} finally {
				lumina.settings.chat.enableAutocomplete = origChatEnableAutocomplete;
				lumina.settings.connections.taskProviderId = origTaskProviderId;
				lumina.settings.connections.taskModelId = origTaskModelId;
				lumina.settings.connections.providers = origProviders;
				lumina.settings.connections.ragEnabled = origRagEnabled;
				lumina.settings.connections.embedding = origEmbedding;
				lumina.settings.projects.list = origProjects;
				lumina.settings.projects.activeProjectId = origActiveProj;
				await lumina.saveSettings();
				app.setting.close();
				// 모바일 모달 닫힘 애니메이션 완료까지 대기
				const closeDeadline = Date.now() + 1500;
				while (Date.now() < closeDeadline) {
					if (!document.querySelector('.modal-container')) break;
					await new Promise(r => setTimeout(r, 50));
				}
			}
		})()`);

		reporter.record(
			'Mobile ChatTab & RagTab: Autocomplete Locked Safely, RAG Warning & Project Switch',
			chatRagTabsResult.success,
			`ChatOverflowOK=${chatRagTabsResult.chatTabNoOverflow}, AutocompleteSubHidden=${chatRagTabsResult.subSettingsHidden}, OrigPreserved=${chatRagTabsResult.originalAutocompletePreserved}, RagWarnings=${chatRagTabsResult.ragWarnings}, RagOverflowOK=${chatRagTabsResult.ragTabNoOverflow}, SwitchSafe=${chatRagTabsResult.switchCompleted}`,
			Date.now() - tChatRagTabs
		);

		// 4. 모바일 채팅 뷰, ModelSelector 뷰포트 경계/필터링, MCP Quick Popup 및 터치 액션 버튼 상시 노출 검증
		const tChatUi = Date.now();
		const chatUiResult = await client.evaluate(`(async () => {
			const lumina = app.plugins.plugins['lumina'];
			const origProviders = JSON.parse(JSON.stringify(lumina.settings.connections.providers || []));
			const origProjects = JSON.parse(JSON.stringify(lumina.settings.projects.list || []));

			try {
				// CLI/로컬 프로바이더가 함께 존재해도 클라우드 모델만 노출되고, MCP 버튼이 활성화되는지 검증
				lumina.settings.connections.providers = [
					{
						id: '__mobile_chat_cloud_prov__',
						type: 'openai',
						credential: 'sk-test',
						availableModels: ['gpt-4o'],
						isVerified: true,
					},
					{
						id: '__mobile_chat_ollama_prov__',
						type: 'ollama',
						credential: '',
						availableModels: ['llama3'],
						isVerified: true,
					},
				];
				for (const proj of lumina.settings.projects.list) {
					proj.defaultProviderId = '__mobile_chat_cloud_prov__';
					proj.defaultModelId = 'gpt-4o';
				}
				await lumina.saveSettings();

				app.workspace.getLeavesOfType('lumina-chat').forEach(l => l.detach());
				app.commands.executeCommandById('lumina:open-chat');
				const deadline = Date.now() + 3000;
				while (Date.now() < deadline) {
					if (document.querySelector('.lumina-chat')) break;
					await new Promise(r => setTimeout(r, 100));
				}
				await new Promise(r => setTimeout(r, 300));

				// ModelSelector 드롭다운 경계(0 <= left, right <= 390) 및 데스크탑 전용(ollama/llama3) 제외 검증
				const modelTrigger = document.querySelector('.lumina-model-selector__trigger');
				modelTrigger?.click();
				await new Promise(r => setTimeout(r, 200));
				const modelDropdown = document.querySelector('.lumina-model-selector__dropdown');
				const ddRect = modelDropdown?.getBoundingClientRect();
				const dropdownInBounds = Boolean(modelDropdown && ddRect && ddRect.left >= 0 && ddRect.right <= 390);
				const dropdownText = Array.from(modelDropdown?.querySelectorAll('.lumina-popup-selector__item') || [])
					.map(el => (el.textContent || '').toLowerCase())
					.join(' | ');
				const desktopModelsExcluded = !dropdownText.includes('llama3') && !dropdownText.includes('ollama');
				modelTrigger?.click();
				await new Promise(r => setTimeout(r, 100));

				// 채팅 하단 툴바에서 MCP(Agent & MCP Tools) 아이콘 버튼 클릭
				const mcpBtn = document.querySelector('.lumina-chat__toolbar-btn[aria-label="Agent & MCP Tools"]');
				mcpBtn?.click();
				await new Promise(r => setTimeout(r, 200));

				const popup = document.querySelector('.lumina-mcp-popup');
				const hasAgentToggle = !!popup?.querySelector('.lumina-mcp-popup__item-agent');
				const hasDesktopAdvancedToggle = !!popup?.querySelector('.lumina-mcp-popup__advanced-toggle');
				const hasLocalServerToggle = !!popup?.querySelector('.lumina-mcp-popup__item-local');

				// 팝업 닫기
				mcpBtn?.click();
				await new Promise(r => setTimeout(r, 100));

				// 히스토리 버튼을 열어 ChatHistoryList 컴포넌트를 마운트시키고 .is-mobile CSS 규칙 및 computed opacity 확인
				const historySvg = document.querySelector('.lumina-chat__header svg.lucide-history');
				const historyBtn = historySvg?.closest('button');
				historyBtn?.click();
				await new Promise(r => setTimeout(r, 200));

				const styleTags = Array.from(document.querySelectorAll('style'));
				const touchActionsVisible = styleTags.some(s => {
					const txt = s.textContent || '';
					return txt.includes('.is-mobile') &&
						(txt.includes('lumina-history__actions') || txt.includes('lumina-message__actions'));
				});
				const historyActionsEl = document.querySelector('.lumina-history__actions');
				const historyActionsOpacity = historyActionsEl ? getComputedStyle(historyActionsEl).opacity : null;
				const historyOpacityOk = historyActionsEl ? historyActionsOpacity === '1' : true;

				historyBtn?.click();
				await new Promise(r => setTimeout(r, 100));

				return {
					success: !!popup && hasAgentToggle && !hasDesktopAdvancedToggle && !hasLocalServerToggle && touchActionsVisible && dropdownInBounds && desktopModelsExcluded && historyOpacityOk,
					popupOpened: !!popup,
					hasAgentToggle,
					hasDesktopAdvancedToggle,
					hasLocalServerToggle,
					touchActionsVisible,
					dropdownInBounds,
					ddLeft: ddRect?.left ?? -1,
					ddRight: ddRect?.right ?? -1,
					desktopModelsExcluded,
					historyActionsOpacity,
				};
			} finally {
				lumina.settings.connections.providers = origProviders;
				lumina.settings.projects.list = origProjects;
				await lumina.saveSettings();
			}
		})()`);

		reporter.record(
			'Mobile Chat UI: ModelSelector Bounds/Filter, MCP Isolation & Touch Opacity',
			chatUiResult.success,
			`Popup: ${chatUiResult.popupOpened}, ModelBounds: ${chatUiResult.dropdownInBounds} (${Math.round(chatUiResult.ddLeft)}..${Math.round(chatUiResult.ddRight)}), OllamaFiltered: ${chatUiResult.desktopModelsExcluded}, TouchCssRule: ${chatUiResult.touchActionsVisible}, HistoryOpacity: ${chatUiResult.historyActionsOpacity ?? 'n/a'}`,
			Date.now() - tChatUi
		);

		// 4-B. Mobile Built-in Agent Execution Without embeddingWorker (create_note & read_note)
		const tAgentExec = Date.now();
		const agentExecResult = await client.evaluate(`(async () => {
			const lumina = app.plugins.plugins['lumina'];
			const origAgentEnabled = lumina.settings.chat.agentEnabled;
			const origExecutionMode = lumina.settings.chat.agentExecutionMode;
			const origRespectExclusions = lumina.settings.mcp.agentRespectRagExclusions;
			const tempNotePath = '__lumina_mobile_agent_e2e__.md';
			const abortController = new AbortController();

			try {
				lumina.settings.chat.agentEnabled = true;
				lumina.settings.chat.agentExecutionMode = 'edit';
				lumina.settings.mcp.agentRespectRagExclusions = false;

				if (!document.querySelector('.lumina-chat')) {
					app.commands.executeCommandById('lumina:open-chat');
					const chatDeadline = Date.now() + 3000;
					while (Date.now() < chatDeadline) {
						if (document.querySelector('.lumina-chat')) break;
						await new Promise(r => setTimeout(r, 100));
					}
				}
				await new Promise(r => setTimeout(r, 250));

				const existing = app.vault.getAbstractFileByPath(tempNotePath);
				if (existing) {
					await app.vault.delete(existing, true);
				}

				const noWorker = lumina.embeddingWorker === null;
				const tools = lumina.mcpManager?.getAllTools?.() || [];
				const createTool = tools.find(t => t.name === 'create_note');
				const readTool = tools.find(t => t.name === 'read_note');
				if (!createTool || !readTool) {
					return { success: false, noWorker, approved: false, createError: false, readMatched: false, reason: 'missing create_note/read_note' };
				}

				const createPromise = lumina.mcpManager.callTool(
					createTool._serverId,
					'create_note',
					{
						path: tempNotePath,
						content: '# Mobile Agent E2E\\nExecuted without embeddingWorker',
					},
					abortController.signal,
				);

				let approved = false;
				for (let i = 0; i < 30; i++) {
					await new Promise(r => setTimeout(r, 100));
					const acceptBtn = document.querySelector('.lumina-inline-approval-card button.mod-cta');
					if (acceptBtn) {
						acceptBtn.click();
						approved = true;
						break;
					}
				}
				if (!approved) {
					abortController.abort();
				}

				let createTimerId = null;
				const createRes = await Promise.race([
					createPromise,
					new Promise((resolve) => {
						createTimerId = setTimeout(() => {
							abortController.abort();
							resolve({ isError: true, timedOut: true, content: [{ type: 'text', text: 'create_note timed out after 5000ms' }] });
						}, 5000);
					}),
				]);
				if (createTimerId !== null) clearTimeout(createTimerId);

				let readRes = null;
				let readText = '';
				if (approved && !createRes?.isError) {
					readRes = await lumina.mcpManager.callTool(readTool._serverId, 'read_note', {
						path: tempNotePath,
					});
					readText = readRes?.content?.[0]?.text || '';
				}
				const readMatched = readText.includes('Executed without embeddingWorker');
				const ok = noWorker && approved && !createRes?.isError && !readRes?.isError && readMatched;

				return {
					success: ok,
					noWorker,
					approved,
					createError: Boolean(createRes?.isError),
					readError: Boolean(readRes?.isError),
					readMatched,
				};
			} finally {
				abortController.abort();
				app.workspace.getLeavesOfType('markdown').forEach(l => {
					if (l.view?.file?.path === tempNotePath) l.detach();
				});
				const f = app.vault.getAbstractFileByPath(tempNotePath);
				if (f) {
					try { await app.vault.delete(f, true); } catch {}
				}
				lumina.settings.chat.agentEnabled = origAgentEnabled;
				lumina.settings.chat.agentExecutionMode = origExecutionMode;
				lumina.settings.mcp.agentRespectRagExclusions = origRespectExclusions;
				await lumina.saveSettings();
			}
		})()`);

		reporter.record(
			'Mobile Built-in Agent Execution (create_note & read_note without Worker)',
			agentExecResult.success,
			`NoWorker: ${agentExecResult.noWorker}, Approved: ${agentExecResult.approved}, CreateErr: ${agentExecResult.createError}, ReadMatched: ${agentExecResult.readMatched}`,
			Date.now() - tAgentExec
		);

		// 4-C. Debug Panel ConfirmModal & Graph View Mobile Mount
		const tDebugGraph = Date.now();
		const debugGraphResult = await client.evaluate(`(async () => {
			const lumina = app.plugins.plugins['lumina'];
			const origDebugMode = lumina.settings.misc.debugMode;
			let debugOverflowOk = false;
			let modalOpened = false;
			let modalCanceled = false;
			let graphMounted = false;
			let graphOverflowOk = false;

			try {
				lumina.settings.misc.debugMode = true;
				await lumina.saveSettings();

				app.workspace.getLeavesOfType('lumina-debug-panel').forEach(l => l.detach());
				app.commands.executeCommandById('lumina:open-devlog');
				const dbgDeadline = Date.now() + 3000;
				while (Date.now() < dbgDeadline) {
					if (document.querySelector('.lumina-debug')) break;
					await new Promise(r => setTimeout(r, 100));
				}
				await new Promise(r => setTimeout(r, 250));

				const dbgLeaf = app.workspace.getLeavesOfType('lumina-debug-panel')[0];
				const dbgEl = dbgLeaf?.view?.contentEl;
				debugOverflowOk = dbgEl ? dbgEl.scrollWidth <= dbgEl.clientWidth + 4 : false;

				const clearBtn = document.querySelector('.lumina-debug__action-btn--danger');
				if (clearBtn && !clearBtn.disabled) {
					clearBtn.click();
					let modal = null;
					const modalOpenDeadline = Date.now() + 1500;
					while (Date.now() < modalOpenDeadline) {
						modal = document.querySelector('.modal-container .modal');
						if (modal) break;
						await new Promise(r => setTimeout(r, 50));
					}
					modalOpened = !!modal;
					if (modal) {
						const cancelBtn = Array.from(modal.querySelectorAll('.modal-content button'))
							.find(b => !b.classList.contains('mod-warning') && !b.classList.contains('mod-cta'))
							|| Array.from(modal.querySelectorAll('button'))
								.find(b => !b.classList.contains('mod-warning') && !b.classList.contains('mod-cta'))
							|| modal.querySelector('.modal-close-button')
							|| modal.querySelector('.modal-header-button');
						cancelBtn?.click();
						// 모바일 모달 닫힘 애니메이션(animateClose) 완료까지 폴링 대기
						const modalCloseDeadline = Date.now() + 1500;
						while (Date.now() < modalCloseDeadline) {
							if (!document.querySelector('.modal-container .modal')) {
								modalCanceled = true;
								break;
							}
							await new Promise(r => setTimeout(r, 50));
						}
					}
				}

				app.workspace.leftSplit?.collapse?.();
				app.workspace.rightSplit?.collapse?.();
				app.workspace.getLeavesOfType('lumina-graph').forEach(l => l.detach());
				app.commands.executeCommandById('lumina:open-graph-view');
				const grpDeadline = Date.now() + 3000;
				while (Date.now() < grpDeadline) {
					if (document.querySelector('.lumina-graph-panel')) break;
					await new Promise(r => setTimeout(r, 100));
				}
				await new Promise(r => setTimeout(r, 250));

				const grpLeaf = app.workspace.getLeavesOfType('lumina-graph')[0];
				const grpEl = grpLeaf?.view?.contentEl;
				const hasGraphPanel = !!grpEl?.querySelector('.lumina-graph-panel');
				const hasGraphSub = Boolean(grpEl?.querySelector('.lumina-graph-controls') || grpEl?.querySelector('.lumina-graph-panel__empty'));
				graphMounted = hasGraphPanel && hasGraphSub;
				graphOverflowOk = grpEl ? grpEl.scrollWidth <= grpEl.clientWidth + 4 : false;

				return {
					success: debugOverflowOk && modalOpened && modalCanceled && graphMounted && graphOverflowOk,
					debugOverflowOk,
					modalOpened,
					modalCanceled,
					graphMounted,
					graphOverflowOk,
				};
			} finally {
				document.querySelectorAll('.modal-container .modal-close-button, .modal-container .modal-header-button').forEach(b => b.click());
				const cleanupDeadline = Date.now() + 800;
				while (Date.now() < cleanupDeadline) {
					if (!document.querySelector('.modal-container')) break;
					await new Promise(r => setTimeout(r, 50));
				}
				app.workspace.getLeavesOfType('lumina-debug-panel').forEach(l => l.detach());
				app.workspace.getLeavesOfType('lumina-graph').forEach(l => l.detach());
				lumina.settings.misc.debugMode = origDebugMode;
				await lumina.saveSettings();
			}
		})()`);

		reporter.record(
			'Mobile Debug Panel ConfirmModal & Graph View Mount',
			debugGraphResult.success,
			`DebugOverflowOK: ${debugGraphResult.debugOverflowOk}, ConfirmModal: ${debugGraphResult.modalOpened}->${debugGraphResult.modalCanceled}, GraphMounted: ${debugGraphResult.graphMounted}, GraphOverflowOK: ${debugGraphResult.graphOverflowOk}`,
			Date.now() - tDebugGraph
		);

		// 4-D. Mobile PromptBar Enter Newline & PdfParser End-to-End Smoke
		const tPromptPdf = Date.now();
		const promptPdfResult = await client.evaluate(`(async () => {
			const lumina = app.plugins.plugins['lumina'];
			const tempNotePath = '__lumina_mobile_promptbar_e2e__.md';
			const tempPdfPath = '__lumina_mobile_parser_e2e__.pdf';
			const origProviders = JSON.parse(JSON.stringify(lumina.settings.connections.providers || []));
			const origQaProv = lumina.settings.connections.quickActionProviderId;
			const origQaModel = lumina.settings.connections.quickActionModelId;

			const buildMinimalPdf = (text) => {
				const esc = text.replace(/([()\\\\])/g, '\\\\$1');
				const stream = 'BT\\n/F1 12 Tf\\n72 720 Td\\n(' + esc + ') Tj\\nET';
				const objs = [
					'1 0 obj\\n<< /Type /Catalog /Pages 2 0 R >>\\nendobj\\n',
					'2 0 obj\\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\\nendobj\\n',
					'3 0 obj\\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\\nendobj\\n',
					'4 0 obj\\n<< /Length ' + stream.length + ' >>\\nstream\\n' + stream + '\\nendstream\\nendobj\\n',
					'5 0 obj\\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\\nendobj\\n',
				];
				let pdf = '%PDF-1.4\\n';
				const offsets = [0];
				for (const o of objs) {
					offsets.push(pdf.length);
					pdf += o;
				}
				const xrefOffset = pdf.length;
				pdf += 'xref\\n0 ' + (objs.length + 1) + '\\n0000000000 65535 f \\n';
				for (let i = 1; i <= objs.length; i++) {
					pdf += String(offsets[i]).padStart(10, '0') + ' 00000 n \\n';
				}
				pdf += 'trailer\\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R >>\\nstartxref\\n' + xrefOffset + '\\n%%EOF\\n';
				const bytes = new Uint8Array(pdf.length);
				for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
				return bytes.buffer;
			};

			let promptBarOpened = false;
			let promptBarWithinViewport = false;
			let promptBarLeft = -1;
			let promptBarRight = -1;
			let promptBarWidth = -1;
			let viewportWidth = window.innerWidth;
			let enterDidNotPreventDefault = false;
			let hasEditor = false;
			let pdfParsedText = false;

			try {
				lumina.settings.connections.providers = [{
					id: '__mobile_prompt_prov__',
					type: 'openai',
					credential: 'sk-test',
					availableModels: ['gpt-4o-mini'],
					isVerified: true,
				}];
				lumina.settings.connections.quickActionProviderId = '__mobile_prompt_prov__';
				lumina.settings.connections.quickActionModelId = 'gpt-4o-mini';

				// 모바일 390px 에디터 공간 확보를 위해 좌/우 사이드바 접기
				app.workspace.leftSplit?.collapse?.();
				app.workspace.rightSplit?.collapse?.();

				// 1) 마크다운 노트 열고 인라인 프롬프트 바 호출 → Enter 시 제출(preventDefault)되지 않고 줄바꿈 허용 확인
				const oldNote = app.vault.getAbstractFileByPath(tempNotePath);
				if (oldNote) await app.vault.delete(oldNote, true);
				const noteFile = await app.vault.create(tempNotePath, 'Sample mobile paragraph for prompt bar test.');
				let existingRootLeaf = app.workspace.getMostRecentLeaf(app.workspace.rootSplit);
				if (!existingRootLeaf) {
					app.workspace.iterateRootLeaves((l) => {
						if (!existingRootLeaf) existingRootLeaf = l;
					});
				}
				const leaf = existingRootLeaf
					? (app.workspace.setActiveLeaf(existingRootLeaf, { focus: true }), app.workspace.getLeaf('tab'))
					: app.workspace.createLeafInParent(app.workspace.rootSplit, 0);
				const setMobileFlags = (mob) => {
					const p = window.__luminaObsidianMod?.Platform;
					if (p) {
						Object.defineProperty(p, 'isMobile', { value: mob, configurable: true, writable: true });
						Object.defineProperty(p, 'isDesktop', { value: !mob, configurable: true, writable: true });
						Object.defineProperty(p, 'isDesktopApp', { value: !mob, configurable: true, writable: true });
						Object.defineProperty(p, 'isMobileApp', { value: mob, configurable: true, writable: true });
						Object.defineProperty(p, 'isPhone', { value: mob, configurable: true, writable: true });
						Object.defineProperty(p, 'isIosApp', { value: mob, configurable: true, writable: true });
					}
					app.isMobile = mob;
				};
				// 데스크탑 Obsidian의 MarkdownView 생성자가 Platform.isMobile=true 시 없는 mobileToolbar.isVisible를
				// 참조해 NPE가 발생하므로, 뷰 생성(openFile) 구간만 일시 해제 후 즉시 모바일 플래그 복원
				setMobileFlags(false);
				try {
					await leaf.openFile(noteFile, { state: { mode: 'source' } });
				} finally {
					setMobileFlags(true);
				}
				app.workspace.setActiveLeaf(leaf, { focus: true });
				await new Promise(r => setTimeout(r, 350));
				const mdView = leaf.view;
				hasEditor = Boolean(mdView?.editor);
				if (mdView?.editor) {
					mdView.editor.focus();
					mdView.editor.setSelection({ line: 0, ch: 0 }, { line: 0, ch: 6 });
					app.commands.executeCommandById('lumina:open-inline-prompt-bar');
					const pbDeadline = Date.now() + 3000;
					while (Date.now() < pbDeadline) {
						const b = document.querySelector('.lumina-promptbar');
						if (b && b.getBoundingClientRect().width > 0) break;
						await new Promise(r => setTimeout(r, 100));
					}
					const bar = document.querySelector('.lumina-promptbar');
					if (bar) {
						promptBarOpened = true;
						const rect = bar.getBoundingClientRect();
						promptBarLeft = Math.round(rect.left);
						promptBarRight = Math.round(rect.right);
						promptBarWidth = Math.round(rect.width);
						viewportWidth = window.innerWidth;
						promptBarWithinViewport = rect.width > 50 && rect.right <= window.innerWidth + 2 && rect.left >= -2;
						const ta = bar.querySelector('textarea');
						if (ta) {
							ta.value = 'Line1';
							const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
							const notCancelled = ta.dispatchEvent(ev);
							enterDidNotPreventDefault = notCancelled && Boolean(document.querySelector('.lumina-promptbar'));
							ta.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
						}
						document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
						bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
					}
				}

				// 2) 실제 PDF 바이너리를 볼트에 생성 후 내장 read_note MCP 툴로 PdfParser.parse() 스모크 검증
				const oldPdf = app.vault.getAbstractFileByPath(tempPdfPath);
				if (oldPdf) await app.vault.delete(oldPdf, true);
				await app.vault.createBinary(tempPdfPath, buildMinimalPdf('Mobile PDF Smoke'));
				const prevAgentEnabled = lumina.settings.chat.agentEnabled;
				lumina.settings.chat.agentEnabled = true;
				const tools = lumina.mcpManager?.getAllTools?.() || [];
				const readTool = tools.find(t => t.name === 'read_note');
				if (readTool) {
					const pdfRes = await lumina.mcpManager.callTool(readTool._serverId, 'read_note', { path: tempPdfPath });
					const extracted = pdfRes?.content?.[0]?.text || '';
					pdfParsedText = !pdfRes?.isError && extracted.includes('Mobile PDF Smoke');
				}
				lumina.settings.chat.agentEnabled = prevAgentEnabled;

				return {
					success: promptBarOpened && promptBarWithinViewport && enterDidNotPreventDefault && pdfParsedText,
					promptBarOpened,
					promptBarWithinViewport,
					promptBarLeft,
					promptBarRight,
					promptBarWidth,
					viewportWidth,
					enterDidNotPreventDefault,
					hasEditor,
					pdfParsedText,
				};
			} finally {
				app.workspace.getLeavesOfType('markdown').forEach(l => {
					if (l.view?.file?.path === tempNotePath) l.detach();
				});
				for (const p of [tempNotePath, tempPdfPath]) {
					const f = app.vault.getAbstractFileByPath(p);
					if (f) { try { await app.vault.delete(f, true); } catch {} }
				}
				lumina.settings.connections.providers = origProviders;
				lumina.settings.connections.quickActionProviderId = origQaProv;
				lumina.settings.connections.quickActionModelId = origQaModel;
			}
		})()`);

		reporter.record(
			'Mobile PromptBar Enter Newline & PdfParser End-to-End Smoke',
			promptPdfResult.success,
			`PromptBar=${promptPdfResult.promptBarOpened} (hasEditor=${promptPdfResult.hasEditor}, inBounds=${promptPdfResult.promptBarWithinViewport} [${promptPdfResult.promptBarLeft}..${promptPdfResult.promptBarRight}/${promptPdfResult.viewportWidth}, w=${promptPdfResult.promptBarWidth}], enterNewlineOK=${promptPdfResult.enterDidNotPreventDefault}), PdfExtracted=${promptPdfResult.pdfParsedText}`,
			Date.now() - tPromptPdf
		);

		// 5. 모바일 Pro 기능 종합 검증 (Split Chat, Voice-to-Note 독립/모바일 경로, Batch Studio)
		await runMobileProSuites(client, input, reporter, mockServer, {
			requiredMode: options.requiredMode ?? null,
		});

		// 6. 전체 모바일 시나리오 종료 후 Node.js require / getBasePath 호출 재감사
		const tFinalAudit = Date.now();
		const finalAudit = await client.evaluate(`(() => {
			const blockedReq = window.__luminaMobileE2EBlockedRequire || [];
			const blockedBasePath = window.__luminaMobileE2EBlockedGetBasePath || [];
			return {
				success: blockedReq.length === 0 && blockedBasePath.length === 0,
				blockedReq,
				blockedBasePath,
			};
		})()`);

		reporter.record(
			'Mobile Final Runtime Audit: Zero Blocked Node.js Require & getBasePath Calls',
			finalAudit.success,
			`BlockedRequires: ${finalAudit.blockedReq.length}${finalAudit.blockedReq.length ? ` [${finalAudit.blockedReq.join(', ')}]` : ''}, BlockedGetBasePath: ${finalAudit.blockedBasePath.length}`,
			Date.now() - tFinalAudit
		);
	} catch (err) {
		reporter.record('Mobile Environment Emulation & Compatibility', false, err.message, Date.now() - tMobileStart);
	} finally {
		// 5. 데스크탑 환경 100% 원상복구
		try {
			await client.send('Emulation.clearDeviceMetricsOverride');
			await client.send('Emulation.setTouchEmulationEnabled', { enabled: false });
		} catch {}

		await client.evaluate(`(async () => {
			const backup = window.__luminaMobileE2EBackup;
			if (!backup) return;

			if (backup.origRequire) {
				window.require = backup.origRequire;
			}
			if (backup.origAdapterRead) {
				app.vault.adapter.read = backup.origAdapterRead;
			}
			if (backup.origAdapterGetBasePath) {
				app.vault.adapter.getBasePath = backup.origAdapterGetBasePath;
			}

			window.__luminaForceMobilePlatform = false;
			const Platform = window.__luminaObsidianMod?.Platform;
			const origPlatform = window.__luminaOrigPlatform;
			if (Platform && origPlatform) {
				Object.defineProperty(Platform, 'isMobile', { value: origPlatform.isMobile, configurable: true, writable: true });
				Object.defineProperty(Platform, 'isDesktop', { value: origPlatform.isDesktop, configurable: true, writable: true });
				Object.defineProperty(Platform, 'isDesktopApp', { value: origPlatform.isDesktopApp, configurable: true, writable: true });
				Object.defineProperty(Platform, 'isMobileApp', { value: origPlatform.isMobileApp, configurable: true, writable: true });
				Object.defineProperty(Platform, 'isPhone', { value: origPlatform.isPhone, configurable: true, writable: true });
				Object.defineProperty(Platform, 'isIosApp', { value: origPlatform.isIosApp, configurable: true, writable: true });
			}

			app.isMobile = backup.appIsMobile;
			if (app.plugins.manifests['lumina']) {
				app.plugins.manifests['lumina'].isDesktopOnly = backup.manifestIsDesktopOnly;
			}

			if (!backup.bodyClasses.isMobile) document.body.classList.remove('is-mobile');
			if (!backup.bodyClasses.isPhone) document.body.classList.remove('is-phone');
			if (backup.bodyClasses.isDesktop) document.body.classList.add('is-desktop');
			document.getElementById('__lumina-mobile-e2e-compat__')?.remove();

			if (backup.leftSplitCollapsed) app.workspace.leftSplit?.collapse?.();
			else app.workspace.leftSplit?.expand?.();
			if (backup.rightSplitCollapsed) app.workspace.rightSplit?.collapse?.();
			else app.workspace.rightSplit?.expand?.();

			if (app.plugins.enabledPlugins.has('lumina')) {
				await app.plugins.disablePlugin('lumina');
				await new Promise(r => setTimeout(r, 200));
			}
			// 테스트 종료 후 플러그인 재활성화 전 Lumina Svelte 스타일 캐시도 함께 정리
			document.head.querySelectorAll('style[id^="svelte-"]').forEach((el) => {
				if ((el.textContent || '').includes('lumina-')) el.remove();
			});
			await app.plugins.enablePlugin('lumina');
			await new Promise(r => setTimeout(r, 500));

			const lumina = app.plugins.plugins['lumina'];
			if (lumina && backup.settingsJson) {
				lumina.settings = JSON.parse(backup.settingsJson);
				await lumina.saveSettings();
			}
			delete window.__luminaMobileE2EBackup;
			delete window.__luminaMobileE2EBlockedGetBasePath;
			delete window.__luminaMobileE2EBlockedRequire;
			delete window.__luminaMobileE2EIsFromLuminaStack;
			delete window.__luminaObsidianMod;
			delete window.__luminaOrigPlatform;
		})()`);
	}
}

run()
	.then(({ failed }) => {
		process.exit(failed > 0 ? 1 : 0);
	})
	.catch((err) => {
		console.error('Fatal error running E2E tests:', err);
		process.exit(1);
	});
