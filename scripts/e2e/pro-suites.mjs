/**
 * Pro 기능 전용 E2E 테스트 스위트 모듈.
 * - 권한 게이트(Free Hidden / Freemium Preview / Pro Active) 정밀 검증
 * - Freemium 잠금 UX 및 ProUpgradeModal 검증
 * - Split Chat(Model Compare) 병렬 스트리밍, Blind Arena, Winner Context, 중단/재시도/수정, 히스토리/내보내기/승격
 * - Batch Studio 5종 레시피(LLM 포함), Pause/Resume/Cancel, 롤백, Auto-Watch 실전 이벤트 감시, Orphan Notes Pro 기능
 * - Voice-to-Note 전체 STT+LLM 파이프라인, 검토 바(재정리/원본/되돌리기), 실제 마크다운 타임스탬프 싱크, 복구/권한 오류/대기 스캐너
 * - 모바일 Pro 3종(Split Chat / Voice-to-Note 지연캡처+클라우드STT / Batch Studio)
 */

async function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * DOM 요소가 실제로 화면에 표시되고 클릭 가능한 좌표에 있는지 검증한 뒤
 * CDP 물리 마우스 클릭을 수행합니다.
 */
export async function physicalClick(client, input, selector) {
	const rect = await client.evaluate(`(() => {
		const el = document.querySelector(${JSON.stringify(selector)});
		if (!el) return { found: false };
		el.scrollIntoView({ block: 'center', inline: 'center' });
		const r = el.getBoundingClientRect();
		const cs = getComputedStyle(el);
		return {
			found: true,
			visible: r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none',
			disabled: Boolean(el.disabled),
			x: r.left + r.width / 2,
			y: r.top + r.height / 2,
		};
	})()`);
	if (!rect || !rect.found) {
		throw new Error(`물리 클릭 대상 요소를 찾을 수 없습니다: ${selector}`);
	}
	if (!rect.visible) {
		throw new Error(`물리 클릭 대상 요소가 화면에 보이지 않습니다: ${selector}`);
	}
	if (rect.disabled) {
		throw new Error(`물리 클릭 대상 요소가 비활성화(disabled) 상태입니다: ${selector}`);
	}
	await input.clickCoords(rect.x, rect.y);
}

/**
 * 테스트 중 생성된 모든 임시 볼트 파일·폴더·Split 히스토리·Export·IndexedDB 상태를 정리합니다.
 */
export async function cleanupProArtifacts(client) {
	await client.evaluate(`(async () => {
		const lumina = app.plugins.plugins['lumina'];
		try { lumina?.voiceNoteManager?.cancelRecording?.(); } catch {}

		const cleanupPaths = [
			'__lumina_e2e_test__.md',
			'__lumina_e2e_mcp_test__.md',
			'__lumina_e2e_voice_test__.md',
			'__lumina_e2e_voice_deferred__.md',
			'__lumina_e2e_voice_reading__.md',
			'VoiceTargetLink.md',
			'__lumina_e2e_batch_test__',
			'__lumina_e2e_move_src__',
			'__lumina_e2e_move_dest__',
			'__lumina_e2e_move_work__',
			'__lumina_e2e_move_fallback__',
			'__lumina_e2e_watch_src__',
			'__lumina_e2e_watch_dest__',
			'__lumina_e2e_orphan_test__',
			'__lumina_e2e_orphan_archive__',
			'__lumina_e2e_voice_audio__',
			'__lumina_e2e_freemium_batch__',
			'__lumina_e2e_freemium_orphan__',
			'__lumina_e2e_mobile_voice__.md',
			'__lumina_mobile_batch_e2e__',
		];
		for (const p of cleanupPaths) {
			const f = app.vault.getAbstractFileByPath(p);
			if (f) {
				try { await app.vault.delete(f, true); } catch {}
			}
		}

		// Split 내보내기·히스토리·새 음성노트 E2E 잔여물 정리
		const mdFiles = app.vault.getMarkdownFiles();
		for (const f of mdFiles) {
			if (
				(f.path.startsWith('Lumina Exports/') && f.name.includes('[Arena]')) ||
				f.name.startsWith('Voice Note ')
			) {
				const content = await app.vault.cachedRead(f).catch(() => '');
				if (
					content.includes('[RESP:mock-model-') ||
					content.includes('E2E Comparison') ||
					content.includes('VoiceTargetLink') ||
					content.includes('Hello from E2E voice recording') ||
					content.includes('__lumina_e2e_voice_audio__') ||
					content.includes('<!-- lumina-voice:pending') ||
					content.includes('Renamed E2E Arena')
				) {
					try { await app.vault.delete(f, true); } catch {}
				}
			}
		}

		const historyBase = (lumina?.settings?.chat?.historyPath || 'chatHistory').replace(/\\/+$/, '');
		const splitHistDir = app.vault.getAbstractFileByPath(historyBase + '/split');
		if (splitHistDir && splitHistDir.children) {
			for (const child of [...splitHistDir.children]) {
				if (child.extension === 'md') {
					const txt = await app.vault.cachedRead(child).catch(() => '');
					if (
						txt.includes('[RESP:mock-model-') ||
						txt.includes('Renamed E2E Arena') ||
						txt.includes('E2E Comparison') ||
						txt.includes('E2E_SPLIT_')
					) {
						try { await app.vault.delete(child, true); } catch {}
					}
				}
			}
		}

		app.workspace.getLeavesOfType('lumina-chat').forEach((l) => l.detach());
		app.workspace.getLeavesOfType('lumina-split-chat').forEach((l) => l.detach());
		app.workspace.getLeavesOfType('lumina-batch-studio').forEach((l) => l.detach());

		// IndexedDB 음성 복구 백업 정리
		if (typeof indexedDB !== 'undefined') {
			await new Promise((resolve) => {
				try {
					const req = indexedDB.open('lumina-voice-recovery-v1', 1);
					req.onupgradeneeded = () => {
						const db = req.result;
						if (!db.objectStoreNames.contains('sessions')) {
							db.createObjectStore('sessions', { keyPath: 'id' });
						}
					};
					req.onsuccess = () => {
						try {
							const db = req.result;
							const tx = db.transaction('sessions', 'readwrite');
							tx.objectStore('sessions').delete('active');
							tx.oncomplete = () => { db.close(); resolve(); };
							tx.onerror = () => { db.close(); resolve(); };
						} catch { resolve(); }
					};
					req.onerror = () => resolve();
				} catch { resolve(); }
			});
		}
	})()`);
}

/**
 * Mock custom 프로바이더를 임시 주입하고 테스트 종료 후 원본 설정을 100% 복원하는 래퍼입니다.
 */
async function withMockProvider(client, mockServer, fn, extraPatch = {}) {
	const backupJson = await client.evaluate(`(() => {
		const lumina = app.plugins.plugins['lumina'];
		if (!lumina) return null;
		return JSON.stringify({
			providers: lumina.settings.connections.providers || [],
			taskProviderId: lumina.settings.connections.taskProviderId ?? '',
			taskModelId: lumina.settings.connections.taskModelId ?? '',
			splitChat: lumina.settings.chat?.splitChat ?? null,
			voiceNote: lumina.settings.voiceNote ?? null,
			batchWatch: lumina.settings.batchWatch ?? null,
			orphanNotes: lumina.settings.orphanNotes ?? null,
			autoSaveHistory: lumina.settings.chat?.autoSaveHistory ?? true,
		});
	})()`);

	await client.evaluate(`(async () => {
		const lumina = app.plugins.plugins['lumina'];
		if (!lumina) throw new Error('Lumina plugin not loaded');
		const mockProv = {
			id: '__e2e_mock_prov__',
			type: 'custom',
			name: 'E2E Mock OpenAI',
			baseUrl: ${JSON.stringify(mockServer.url)},
			credential: 'e2e-mock-key',
			availableModels: ${JSON.stringify(mockServer.availableModels)},
			isVerified: true,
		};
		const filtered = (lumina.settings.connections.providers || []).filter((p) => p.id !== '__e2e_mock_prov__');
		lumina.settings.connections.providers = [mockProv, ...filtered];
		lumina.settings.connections.taskProviderId = '__e2e_mock_prov__';
		lumina.settings.connections.taskModelId = 'mock-model-a';
		lumina.settings.chat.splitChat = {
			...(lumina.settings.chat?.splitChat || {}),
			lastSlots: [
				{ providerId: '__e2e_mock_prov__', modelId: 'mock-model-a' },
				{ providerId: '__e2e_mock_prov__', modelId: 'mock-model-b' },
			],
		};

		const extra = ${JSON.stringify(extraPatch)};
		if (extra.voiceNote) {
			lumina.settings.voiceNote = { ...(lumina.settings.voiceNote || {}), ...extra.voiceNote };
		}
		if (extra.autoSaveHistory !== undefined) {
			lumina.settings.chat.autoSaveHistory = extra.autoSaveHistory;
		}
		await lumina.saveSettings();
	})()`);

	mockServer.clearRequests();
	try {
		return await fn();
	} finally {
		if (backupJson) {
			await client.evaluate(`(async () => {
				const lumina = app.plugins.plugins['lumina'];
				if (!lumina) return;
				const b = ${backupJson};
				lumina.settings.connections.providers = b.providers;
				lumina.settings.connections.taskProviderId = b.taskProviderId;
				lumina.settings.connections.taskModelId = b.taskModelId;
				lumina.settings.chat.autoSaveHistory = b.autoSaveHistory;
				if (b.splitChat === null) delete lumina.settings.chat.splitChat;
				else lumina.settings.chat.splitChat = b.splitChat;
				if (b.voiceNote === null) delete lumina.settings.voiceNote;
				else lumina.settings.voiceNote = b.voiceNote;
				if (b.batchWatch === null) delete lumina.settings.batchWatch;
				else lumina.settings.batchWatch = b.batchWatch;
				if (b.orphanNotes === null) delete lumina.settings.orphanNotes;
				else lumina.settings.orphanNotes = b.orphanNotes;
				await lumina.saveSettings();
				lumina.folderWatchManager?.syncWatchers?.();
				lumina.updateRibbonIcon?.();
			})()`);
		}
	}
}

/**
 * 현재 로드된 빌드의 권한 상태(free-hidden / freemium-preview / pro-active / inconsistent)를 정밀 판별합니다.
 */
export async function detectEntitlementMode(client) {
	const proStatus = await client.evaluate(`(() => {
		const lumina = app.plugins.plugins['lumina'];
		const cmds = Object.keys(app.commands.commands);
		const views = Object.keys(app.viewRegistry.viewByType);
		const showVoiceRibbon = lumina?.settings?.voiceNote?.showRibbonIcon ?? true;
		return {
			hasSplitCmd: cmds.includes('lumina:open-split-chat'),
			hasBatchCmd: cmds.includes('lumina:open-batch-studio'),
			hasOrphanCmd: cmds.includes('lumina:open-orphan-notes'),
			hasVoiceToggleCmd: cmds.includes('lumina:toggle-voice-note-recording'),
			hasVoiceUploadCmd: cmds.includes('lumina:transcribe-audio-file'),
			hasVoicePendingCmd: cmds.includes('lumina:process-pending-voice-notes'),
			hasSplitView: views.includes('lumina-split-chat'),
			hasBatchView: views.includes('lumina-batch-studio'),
			hasVoiceManager: !!lumina?.voiceNoteManager,
			hasFolderWatchManager: !!lumina?.folderWatchManager,
			hasVoiceRibbon: !!lumina?.voiceRibbonEl,
			showVoiceRibbon,
			voiceRibbonOk: !showVoiceRibbon || !!lumina?.voiceRibbonEl,
		};
	})()`);

	const featureEntriesPresent = [
		proStatus.hasSplitCmd,
		proStatus.hasBatchCmd,
		proStatus.hasOrphanCmd,
		proStatus.hasVoiceToggleCmd,
		proStatus.hasVoiceUploadCmd,
		proStatus.hasVoicePendingCmd,
		proStatus.hasSplitView,
		proStatus.hasBatchView,
		proStatus.hasVoiceManager,
	];

	const nonePresent = featureEntriesPresent.every((v) => !v) && !proStatus.hasFolderWatchManager && !proStatus.hasVoiceRibbon;
	const allFeatureEntriesPresent = featureEntriesPresent.every(Boolean) && proStatus.voiceRibbonOk;

	let mode = 'inconsistent';
	if (nonePresent) {
		mode = 'free-hidden';
	} else if (allFeatureEntriesPresent && proStatus.hasFolderWatchManager) {
		mode = 'pro-active';
	} else if (allFeatureEntriesPresent && !proStatus.hasFolderWatchManager) {
		mode = 'freemium-preview';
	}

	return { mode, proStatus };
}

/**
 * SUITE 11: Pro 권한 게이트 및 3-모드 일관성 검증 (Free Hidden / Freemium Preview / Pro Active).
 */
export async function runProEntitlementGateSuite(client, input, reporter, options = {}) {
	reporter.startSuite('Pro Entitlement Gate & Feature Visibility');
	const tGate = Date.now();
	const { requiredMode = null } = options;

	try {
		const { mode, proStatus } = await detectEntitlementMode(client);

		if (mode === 'inconsistent') {
			reporter.record(
				'Pro Entitlement Consistency',
				false,
				`부분적/불일치 Pro 상태 감지: ${JSON.stringify(proStatus)}`,
				Date.now() - tGate,
			);
			return { mode, proStatus };
		}

		if (requiredMode && mode !== requiredMode) {
			reporter.record(
				`Required Entitlement Mode (${requiredMode})`,
				false,
				`요구 모드=${requiredMode}, 실제 빌드 모드=${mode} (${JSON.stringify(proStatus)})`,
				Date.now() - tGate,
			);
			return { mode, proStatus };
		}

		if (mode === 'free-hidden') {
			reporter.record(
				'Free Mode: All 6 Pro Commands, 2 Views, Managers & Voice Ribbon Hidden',
				true,
				'6개 Pro 커맨드, 2개 Pro 뷰, VoiceNoteManager, FolderWatchManager, Voice 리본 모두 완전 은닉 확인',
				Date.now() - tGate,
			);

			// Chat 헤더 Split 버튼, /arena 슬래시 및 Discovery 고아노트 배너 은닉 확인
			const tUiGate = Date.now();
			try {
				await client.evaluate(`(async () => {
					app.workspace.getLeavesOfType('lumina-chat').forEach((l) => l.detach());
					app.commands.executeCommandById('lumina:open-chat');
					const deadline = Date.now() + 3000;
					while (Date.now() < deadline) {
						if (document.querySelector('.lumina-chat-view textarea')) break;
						await new Promise((r) => setTimeout(r, 100));
					}
				})()`);
				await sleep(250);

				const uiGate = await client.evaluate(`(async () => {
					const hasSplitHeaderBtn = !!document.querySelector('.lumina-chat__header svg.lumina-split-chat');
					const textarea = document.querySelector('.lumina-chat-view textarea');
					let hasArenaSlash = false;
					if (textarea) {
						const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
						setter.call(textarea, '/arena');
						textarea.dispatchEvent(new Event('input', { bubbles: true }));
						await new Promise((r) => setTimeout(r, 200));
						const badges = Array.from(document.querySelectorAll('.lumina-slash-selector__item-badge')).map((el) => (el.textContent || '').trim());
						hasArenaSlash = badges.includes('/arena');
						setter.call(textarea, '');
						textarea.dispatchEvent(new Event('input', { bubbles: true }));
					}

					// Discovery 탭 고아노트 배너 은닉 확인
					document.querySelector('.lumina-sidebar__tab:nth-child(2)')?.click();
					await new Promise((r) => setTimeout(r, 250));
					const hasOrphanBanner = !!document.querySelector('.lumina-discovery__orphan-bar');
					document.querySelector('.lumina-sidebar__tab:nth-child(1)')?.click();
					await new Promise((r) => setTimeout(r, 150));

					return { hasSplitHeaderBtn, hasArenaSlash, hasOrphanBanner };
				})()`);

				reporter.record(
					'Free Mode: Chat Split Button, /arena Slash & Discovery Orphan Banner Hidden',
					!uiGate.hasSplitHeaderBtn && !uiGate.hasArenaSlash && !uiGate.hasOrphanBanner,
					`SplitBtnHidden=${!uiGate.hasSplitHeaderBtn}, /arenaHidden=${!uiGate.hasArenaSlash}, OrphanBarHidden=${!uiGate.hasOrphanBanner}`,
					Date.now() - tUiGate,
				);
			} finally {
				await client.evaluate(`app.workspace.getLeavesOfType('lumina-chat').forEach((l) => l.detach());`);
			}

			// editor-menu, file-menu, // 인라인 서제스트 및 뷰 강제 오픈 차단 확인
			const tEntryGate = Date.now();
			const entryGate = await client.evaluate(`(async () => {
				const lumina = app.plugins.plugins['lumina'];
				const createFakeMenu = () => {
					const items = [];
					const menu = {
						items,
						addItem(cb) {
							const item = {
								title: '',
								setTitle(t) { this.title = t; return this; },
								setIcon() { return this; },
								setSection() { return this; },
								onClick() { return this; },
								setSubmenu() { return createSubmenu(items); },
							};
							cb(item);
							if (item.title) items.push(item.title);
							return this;
						},
						addSeparator() { return this; },
					};
					return menu;
				};
				const createSubmenu = (parentItems) => ({
					addItem(cb) {
						const item = {
							title: '',
							setTitle(t) { this.title = t; return this; },
							setIcon() { return this; },
							setSection() { return this; },
							onClick() { return this; },
						};
						cb(item);
						if (item.title) parentItems.push(item.title);
						return this;
					},
					addSeparator() { return this; },
				});

				// 1) file-menu (폴더 / .wav)
				const { TFolder, TFile } = window.__luminaObsidianMod || {};
				const fakeFolder = TFolder ? Object.assign(Object.create(TFolder.prototype), { path: '__fake_dir__', name: '__fake_dir__' }) : { path: '__fake_dir__', children: [] };
				const folderMenu = createFakeMenu();
				app.workspace.trigger('file-menu', folderMenu, fakeFolder);

				const fakeWav = TFile ? Object.assign(Object.create(TFile.prototype), { path: '__fake.wav', name: '__fake.wav', extension: 'wav', basename: '__fake' }) : { path: '__fake.wav', extension: 'wav' };
				const wavMenu = createFakeMenu();
				app.workspace.trigger('file-menu', wavMenu, fakeWav);

				// 2) editor-menu
				const edMenu = createFakeMenu();
				const fakeEditor = { getSelection: () => 'sample' };
				app.workspace.trigger('editor-menu', edMenu, fakeEditor, { file: null });

				// 3) InlineAISuggest (//)
				const suggests = app.workspace.editorSuggest?.suggests || [];
				const inlineSug = suggests.find((s) => s && typeof s.getSuggestions === 'function' && s.plugin === lumina);
				const sugItems = inlineSug ? inlineSug.getSuggestions({ query: '' }) : [];
				const hasVoiceInSuggest = sugItems.some((it) => String(it?.id || '').includes('voice'));

				// 4) 뷰 강제 오픈 시 즉시 차단 확인
				const leaf = app.workspace.getLeaf('tab');
				await leaf.setViewState({ type: 'lumina-split-chat', active: true }).catch(() => {});
				await new Promise((r) => setTimeout(r, 150));
				const splitMounted = !!document.querySelector('.lumina-split-root');
				leaf.detach();

				return {
					folderHasBatch: folderMenu.items.some((t) => t.toLowerCase().includes('batch')),
					wavHasVoice: wavMenu.items.some((t) => t.toLowerCase().includes('voice') || t.includes('음성')),
					editorHasVoice: edMenu.items.some((t) => t.toLowerCase().includes('voice') || t.includes('녹음')),
					hasVoiceInSuggest,
					splitMounted,
				};
			})()`);

			reporter.record(
				'Free Mode: Context Menus, // Inline Suggest & Forced View Open Blocked',
				!entryGate.folderHasBatch &&
					!entryGate.wavHasVoice &&
					!entryGate.editorHasVoice &&
					!entryGate.hasVoiceInSuggest &&
					!entryGate.splitMounted,
				`folderBatch=${entryGate.folderHasBatch}, wavVoice=${entryGate.wavHasVoice}, editorVoice=${entryGate.editorHasVoice}, inlineVoice=${entryGate.hasVoiceInSuggest}, splitMounted=${entryGate.splitMounted}`,
				Date.now() - tEntryGate,
			);

			// Misc 설정 탭 및 설정 검색에서 Voice-to-Note 미노출 확인
			const tSettingsGate = Date.now();
			try {
				await client.evaluate(`(async () => {
					app.setting.open();
					app.setting.openTabById('lumina');
					const deadline = Date.now() + 3000;
					while (Date.now() < deadline) {
						if (document.querySelector('.lumina-settings__nav-btn')) break;
						await new Promise((r) => setTimeout(r, 100));
					}
				})()`);
				await sleep(250);

				const voiceSettingGate = await client.evaluate(`(async () => {
					const container = app.setting.activeTab?.containerEl;
					const navBtns = Array.from(container?.querySelectorAll('.lumina-settings__nav-btn:not(.lumina-settings__nav-btn--advanced)') || []);
					navBtns[navBtns.length - 1]?.click();
					await new Promise((r) => setTimeout(r, 200));
					const hiddenInMisc = !(container?.textContent || '').includes('AI Voice-to-Note');

					const searchInput = container?.querySelector('.lumina-settings__search-input');
					let hiddenInSearch = true;
					if (searchInput) {
						const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
						setter.call(searchInput, 'voice');
						searchInput.dispatchEvent(new Event('input', { bubbles: true }));
						await new Promise((r) => setTimeout(r, 200));
						hiddenInSearch = !(container?.textContent || '').includes('AI Voice-to-Note');
						setter.call(searchInput, '');
						searchInput.dispatchEvent(new Event('input', { bubbles: true }));
					}
					return { hiddenInMisc, hiddenInSearch };
				})()`);

				await input.pressEscape();
				await sleep(250);

				reporter.record(
					'Free Mode: Voice-to-Note Settings Hidden in Misc & Search',
					voiceSettingGate.hiddenInMisc && voiceSettingGate.hiddenInSearch,
					`HiddenInMisc=${voiceSettingGate.hiddenInMisc}, HiddenInSearch=${voiceSettingGate.hiddenInSearch}`,
					Date.now() - tSettingsGate,
				);
			} catch (err) {
				await input.pressEscape();
				reporter.record('Free Mode: Voice-to-Note Settings Hidden in Misc & Search', false, err.message, Date.now() - tSettingsGate);
			}
		} else {
			// freemium-preview 또는 pro-active 모드에서 진입점 일관성 + 플러그인 리로드 복원력 검증
			reporter.record(
				`Entitlement Mode Detected: ${mode}`,
				true,
				`6개 Pro 커맨드, 2개 Pro 뷰, VoiceManager=${proStatus.hasVoiceManager}, FolderWatchManager=${proStatus.hasFolderWatchManager}, VoiceRibbon=${proStatus.hasVoiceRibbon}`,
				Date.now() - tGate,
			);

			const tReload = Date.now();
			const reloadCheck = await client.evaluate(`(async () => {
				const f = await app.vault.create('__lumina_e2e_voice_test__.md', '# Reload Check');
				const leaf = app.workspace.getLeaf(false);
				await leaf.openFile(f);
				await new Promise((r) => setTimeout(r, 200));

				await app.plugins.disablePlugin('lumina');
				await new Promise((r) => setTimeout(r, 200));
				await app.plugins.enablePlugin('lumina');
				await new Promise((r) => setTimeout(r, 600));

				const lumina = app.plugins.plugins['lumina'];
				const viewActionCount = leaf.view?.containerEl?.querySelectorAll('.lumina-voice-view-action')?.length || 0;
				const statusBarCount = document.querySelectorAll('.status-bar-item.lumina-watch-statusbar').length;

				leaf.detach();
				await app.vault.delete(f, true);

				return {
					hasVoiceManager: !!lumina?.voiceNoteManager,
					hasFolderWatchManager: !!lumina?.folderWatchManager,
					viewActionCount,
					statusBarCount,
				};
			})()`);

			const expectedWatch = mode === 'pro-active';
			const expectedStatusBarCount = expectedWatch ? 1 : 0;
			reporter.record(
				'Pro Managers Clean Reload & Zero Duplicate ViewAction / StatusBar Leaks',
				reloadCheck.hasVoiceManager &&
					reloadCheck.hasFolderWatchManager === expectedWatch &&
					reloadCheck.viewActionCount === 1 &&
					reloadCheck.statusBarCount === expectedStatusBarCount,
				`VoiceMgr=${reloadCheck.hasVoiceManager}, WatchMgr=${reloadCheck.hasFolderWatchManager}, ViewActions=${reloadCheck.viewActionCount}, StatusBars=${reloadCheck.statusBarCount}`,
				Date.now() - tReload,
			);
		}

		return { mode, proStatus };
	} catch (err) {
		reporter.record('Pro Entitlement Gate & Feature Visibility', false, err.message, Date.now() - tGate);
		return { mode: 'error', proStatus: null };
	}
}

/**
 * Freemium Preview 모드 전용 잠금 UX 및 ProUpgradeModal 검증 스위트.
 */
export async function runFreemiumPreviewSuite(client, input, reporter, mockServer) {
	reporter.startSuite('Freemium Preview Locks & ProUpgradeModal');

	await withMockProvider(client, mockServer, async () => {
		// 1. Split Chat Freemium 잠금 + ProUpgradeModal 라이선스 키 검증
		const tSplitLock = Date.now();
		try {
			await client.evaluate(`(async () => {
				app.workspace.getLeavesOfType('lumina-split-chat').forEach((l) => l.detach());
				app.commands.executeCommandById('lumina:open-split-chat');
				const deadline = Date.now() + 3500;
				while (Date.now() < deadline) {
					if (document.querySelector('.lumina-split-root')) break;
					await new Promise((r) => setTimeout(r, 100));
				}
			})()`);
			await sleep(250);

			const splitLock = await client.evaluate(`(async () => {
				const root = document.querySelector('.lumina-split-root');
				if (!root) return { success: false, reason: 'Split root not mounted' };
				const slotCount = root.querySelectorAll('.lumina-split-slotbar__cell, .lumina-split-slotbar__mobile-tab').length;
				const addBtn = root.querySelector('.lumina-split-header__add-btn');
				const addLocked = Boolean(addBtn?.classList.contains('is-locked'));

				// + 모델 추가 클릭 -> 잠금 Notice 표시
				document.querySelectorAll('.notice').forEach((n) => n.remove());
				addBtn?.click();
				await new Promise((r) => setTimeout(r, 150));
				const addNoticeLink = document.querySelector('.notice .lumina-pro-notice-link');

				// Blind & Winner 버튼 클릭 -> 활성화되지 않음 + 잠금 Notice
				const blindBtn = root.querySelectorAll('.lumina-split-header__left .lumina-split-header__seg-btn')[1];
				const winnerBtn = root.querySelectorAll('.lumina-split-header__context-group .lumina-split-header__seg-btn')[1];
				blindBtn?.click();
				await new Promise((r) => setTimeout(r, 100));
				const blindNotActivated = !blindBtn?.classList.contains('is-active');
				winnerBtn?.click();
				await new Promise((r) => setTimeout(r, 100));
				const winnerNotActivated = !winnerBtn?.classList.contains('is-active');

				// 토스트 링크 클릭 -> ProUpgradeModal 오픈 및 split-chat 강조
				addNoticeLink?.click();
				await new Promise((r) => setTimeout(r, 200));
				const modal = document.querySelector('.lumina-pro-upgrade-modal');
				const highlightedCount = modal?.querySelectorAll('.lumina-pro-upgrade-modal__card.is-highlighted')?.length || 0;

				const keyInput = modal?.querySelector('.lumina-pro-upgrade-modal__license-input');
				const activateBtn = modal?.querySelector('.lumina-pro-upgrade-modal__activate-btn');
				document.querySelectorAll('.notice').forEach((n) => n.remove());
				activateBtn?.click();
				await new Promise((r) => setTimeout(r, 120));
				const emptyNoticeShown = document.querySelectorAll('.notice').length > 0;

				if (keyInput) {
					keyInput.value = 'LUMINA-TEST-KEY-1234';
				}
				document.querySelectorAll('.notice').forEach((n) => n.remove());
				activateBtn?.click();
				await new Promise((r) => setTimeout(r, 120));
				const preLaunchNoticeShown = document.querySelectorAll('.notice').length > 0;

				modal?.querySelector('.lumina-pro-upgrade-modal__close-btn')?.click();
				await new Promise((r) => setTimeout(r, 150));
				const modalClosed = !document.querySelector('.lumina-pro-upgrade-modal');

				return {
					success:
						slotCount === 2 &&
						addLocked &&
						!!addNoticeLink &&
						blindNotActivated &&
						winnerNotActivated &&
						!!modal &&
						highlightedCount === 1 &&
						emptyNoticeShown &&
						preLaunchNoticeShown &&
						modalClosed,
					slotCount,
					addLocked,
					hasToastLink: !!addNoticeLink,
					blindNotActivated,
					winnerNotActivated,
					modalOpened: !!modal,
					highlightedCount,
					emptyNoticeShown,
					preLaunchNoticeShown,
					modalClosed,
				};
			})()`);

			reporter.record(
				'Freemium Split Chat: 2-Slot Cap, Blind/Winner Lock & ProUpgradeModal Flow',
				splitLock.success,
				`Slots=${splitLock.slotCount}, AddLocked=${splitLock.addLocked}, Modal=${splitLock.modalOpened}(highlight=${splitLock.highlightedCount}), Notices=${splitLock.emptyNoticeShown}/${splitLock.preLaunchNoticeShown}, Closed=${splitLock.modalClosed}`,
				Date.now() - tSplitLock,
			);
		} finally {
			await client.evaluate(`
				document.querySelectorAll('.notice').forEach((n) => n.remove());
				app.workspace.getLeavesOfType('lumina-split-chat').forEach((l) => l.detach());
			`);
		}

		// 2. Batch Studio Freemium 잠금 (5개 제한 + Custom Prompt / Bulk Apply / Auto-Watch / Orphans)
		const tBatchLock = Date.now();
		try {
			await client.evaluate(`(async () => {
				const folder = '__lumina_e2e_freemium_batch__';
				const existing = app.vault.getAbstractFileByPath(folder);
				if (existing) await app.vault.delete(existing, true);
				await app.vault.createFolder(folder);
				await app.vault.create(folder + '/TargetHub.md', 'Hub note for freemium autolink check.');
				for (let i = 1; i <= 7; i++) {
					await app.vault.create(folder + '/Note_' + i + '.md', 'Note ' + i + ' mentions TargetHub in plain text for autolink batch.');
				}
				app.workspace.getLeavesOfType('lumina-batch-studio').forEach((l) => l.detach());
				app.commands.executeCommandById('lumina:open-batch-studio');
				const deadline = Date.now() + 3500;
				while (Date.now() < deadline) {
					if (document.querySelector('div.lumina-batch-studio')) break;
					await new Promise((r) => setTimeout(r, 100));
				}
			})()`);
			await sleep(300);

			const batchLock = await client.evaluate(`(async () => {
				const studio = document.querySelector('div.lumina-batch-studio');
				if (!studio) return { success: false, reason: 'Batch Studio not mounted' };

				// Custom Prompt 탭 잠금 확인
				const recipeTabs = studio.querySelectorAll('.lumina-batch-recipe-tab');
				const customTabLocked = Boolean(recipeTabs[3]?.classList.contains('is-locked'));
				recipeTabs[3]?.click();
				await new Promise((r) => setTimeout(r, 120));
				const customPromptBlocked = !recipeTabs[3]?.classList.contains('is-active');

				// Autolink 7건 실행 -> 5개 staged + 2개 locked 확인
				recipeTabs[1]?.click();
				await new Promise((r) => setTimeout(r, 150));
				studio.querySelectorAll('.lumina-batch-segmented button')[1]?.click();
				await new Promise((r) => setTimeout(r, 100));
				const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
				const folderInput = studio.querySelector('input[list="lumina-batch-folder-list"]');
				if (folderInput) {
					setter.call(folderInput, '__lumina_e2e_freemium_batch__');
					folderInput.dispatchEvent(new Event('input', { bubbles: true }));
				}
				await new Promise((r) => setTimeout(r, 300));
				studio.querySelector('.lumina-batch-start-btn')?.click();

				const deadline = Date.now() + 8000;
				while (Date.now() < deadline) {
					if (studio.querySelector('.lumina-batch-status-pill.is-completed')) break;
					await new Promise((r) => setTimeout(r, 100));
				}

				const stagedItems = studio.querySelectorAll('.lumina-batch-queue-item:not(.is-locked)').length;
				const lockedItems = Array.from(studio.querySelectorAll('.lumina-batch-queue-item.is-locked'));
				lockedItems[0]?.click();
				await new Promise((r) => setTimeout(r, 150));
				const hasLockedInspectorCard = !!studio.querySelector('.lumina-batch-locked-card');
				const bulkApplyLocked = Boolean(studio.querySelector('.lumina-batch-bulk-apply-btn')?.classList.contains('is-locked'));

				// Auto-Watch 탭 잠금 배너 확인
				studio.querySelector('.lumina-batch-main-tab[data-tab="watch"]')?.click();
				await new Promise((r) => setTimeout(r, 150));
				const hasWatchProCard = !!studio.querySelector('.lumina-watch-pro-card');

				// Orphan Notes 탭 Pro 잠금 버튼 확인
				studio.querySelector('.lumina-batch-main-tab[data-tab="orphans"]')?.click();
				await new Promise((r) => setTimeout(r, 250));
				const orphanBulkLockedCount = studio.querySelectorAll('.lumina-orphan-bulk-actions button.is-locked').length;

				return {
					success:
						customTabLocked &&
						customPromptBlocked &&
						lockedItems.length >= 2 &&
						stagedItems <= 6 &&
						hasLockedInspectorCard &&
						bulkApplyLocked &&
						hasWatchProCard &&
						orphanBulkLockedCount === 4,
					customTabLocked,
					customPromptBlocked,
					stagedItems,
					lockedCount: lockedItems.length,
					hasLockedInspectorCard,
					bulkApplyLocked,
					hasWatchProCard,
					orphanBulkLockedCount,
				};
			})()`);

			reporter.record(
				'Freemium Batch Studio: 5-File Cap, Locked Card, Custom Prompt, Watch & Orphan Bulk Locks',
				batchLock.success,
				`CustomLocked=${batchLock.customTabLocked}/${batchLock.customPromptBlocked}, LockedQueue=${batchLock.lockedCount}, InspectorCard=${batchLock.hasLockedInspectorCard}, WatchProCard=${batchLock.hasWatchProCard}, OrphanBulkLocks=${batchLock.orphanBulkLockedCount}`,
				Date.now() - tBatchLock,
			);
		} finally {
			await client.evaluate(`(async () => {
				app.workspace.getLeavesOfType('lumina-batch-studio').forEach((l) => l.detach());
				const f = app.vault.getAbstractFileByPath('__lumina_e2e_freemium_batch__');
				if (f) await app.vault.delete(f, true);
			})()`);
		}

		// 3. Voice-to-Note Freemium 잠금 (설정 잠금 + 5분(300초) 초과 오디오 차단)
		const tVoiceLock = Date.now();
		try {
			await client.evaluate(`(async () => {
				app.setting.open();
				app.setting.openTabById('lumina');
				const deadline = Date.now() + 3000;
				while (Date.now() < deadline) {
					if (document.querySelector('.lumina-settings__nav-btn')) break;
					await new Promise((r) => setTimeout(r, 100));
				}
			})()`);
			await sleep(200);

			const settingLock = await client.evaluate(`(async () => {
				const container = app.setting.activeTab?.containerEl;
				const navBtns = Array.from(container?.querySelectorAll('.lumina-settings__nav-btn:not(.lumina-settings__nav-btn--advanced)') || []);
				navBtns[navBtns.length - 1]?.click();
				await new Promise((r) => setTimeout(r, 200));
				const proBadges = container?.querySelectorAll('.lumina-pro-badge-inline')?.length || 0;
				const lockedTextarea = !!container?.querySelector('textarea.is-locked[readonly]');
				app.setting.close();
				return { proBadges, lockedTextarea };
			})()`);

			// 305초(4000Hz 8-bit 모노 PCM WAV) 생성 후 transcribeVaultFile 호출 시 STT 요청 0건 + 차단 확인
			mockServer.clearRequests();
			const durationCheck = await client.evaluate(`(async () => {
				const lumina = app.plugins.plugins['lumina'];
				const sr = 4000;
				const sec = 305;
				const samples = sr * sec;
				const buf = new ArrayBuffer(44 + samples);
				const dv = new DataView(buf);
				const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
				w(0, 'RIFF');
				dv.setUint32(4, 36 + samples, true);
				w(8, 'WAVE');
				w(12, 'fmt ');
				dv.setUint32(16, 16, true);
				dv.setUint16(20, 1, true);
				dv.setUint16(22, 1, true);
				dv.setUint32(24, sr, true);
				dv.setUint32(28, sr, true);
				dv.setUint16(32, 1, true);
				dv.setUint16(34, 8, true);
				w(36, 'data');
				dv.setUint32(40, samples, true);

				const folder = '__lumina_e2e_voice_audio__';
				const existingFolder = app.vault.getAbstractFileByPath(folder);
				if (existingFolder) await app.vault.delete(existingFolder, true);
				await app.vault.createFolder(folder);
				const wavFile = await app.vault.createBinary(folder + '/too_long_305s.wav', buf);

				document.querySelectorAll('.notice').forEach((n) => n.remove());
				await lumina.voiceNoteManager.transcribeVaultFile(wavFile);
				await new Promise((r) => setTimeout(r, 200));
				const hasLockNotice = !!document.querySelector('.notice .lumina-pro-notice-link');
				await app.vault.delete(app.vault.getAbstractFileByPath(folder), true);
				document.querySelectorAll('.notice').forEach((n) => n.remove());
				return { hasLockNotice };
			})()`);

			const sttAfterBlocked = mockServer.getSttRequests().length;
			reporter.record(
				'Freemium Voice-to-Note: Settings Badges/Readonly Vocab & 5-Min (305s) Audio Gate',
				settingLock.proBadges >= 4 && settingLock.lockedTextarea && durationCheck.hasLockNotice && sttAfterBlocked === 0,
				`ProBadges=${settingLock.proBadges}, LockedVocab=${settingLock.lockedTextarea}, >300sNotice=${durationCheck.hasLockNotice}, SttRequests=${sttAfterBlocked}`,
				Date.now() - tVoiceLock,
			);
		} catch (err) {
			reporter.record('Freemium Voice-to-Note Gate', false, err.message, Date.now() - tVoiceLock);
		}
	});
}

/**
 * Split Chat 프롬프트 입력창에 텍스트를 입력하고 전송 버튼이 활성화된 것을 확인한 뒤 물리 클릭으로 전송합니다.
 */
async function sendSplitPromptPhysically(client, input, text) {
	await client.evaluate(`(async () => {
		const root = document.querySelector('.lumina-split-root');
		root?.querySelector('.lumina-split-header')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
		await new Promise((r) => setTimeout(r, 80));
		const ta = root?.querySelector('textarea');
		if (ta) {
			ta.scrollIntoView({ block: 'center' });
			ta.focus();
		}
	})()`);
	await input.type('.lumina-split-root textarea', text);
	await client.evaluate(`(async () => {
		const root = document.querySelector('.lumina-split-root');
		const ta = root?.querySelector('textarea');
		if (ta && ta.value !== ${JSON.stringify(text)}) {
			const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
			setter.call(ta, ${JSON.stringify(text)});
			ta.dispatchEvent(new Event('input', { bubbles: true }));
		}
		const dead = Date.now() + 2000;
		while (Date.now() < dead) {
			const btn = root?.querySelector('.lumina-chat__send-btn');
			if (btn && !btn.disabled) break;
			await new Promise((r) => setTimeout(r, 50));
		}
	})()`);
	await physicalClick(client, input, '.lumina-split-root .lumina-chat__send-btn');
}

/**
 * SUITE 12: Split Chat / Model Compare (Pro Active) 전체 E2E 스위트.
 */
export async function runSplitChatProSuite(client, input, reporter, mockServer) {
	reporter.startSuite('Split Chat / Model Compare (Pro)');

	await withMockProvider(client, mockServer, async () => {
		try {
			// 1. 진입점: 채팅 헤더 물리 클릭 & /arena 슬래시 실제 실행으로 SplitChatView 오픈
			const tEntry = Date.now();
			await client.evaluate(`(async () => {
				app.workspace.getLeavesOfType('lumina-chat').forEach((l) => l.detach());
				app.workspace.getLeavesOfType('lumina-split-chat').forEach((l) => l.detach());
				app.commands.executeCommandById('lumina:open-chat');
				const deadline = Date.now() + 3000;
				while (Date.now() < deadline) {
					if (document.querySelector('.lumina-chat-view textarea')) break;
					await new Promise((r) => setTimeout(r, 100));
				}
			})()`);
			await sleep(250);

			// 채팅 헤더 Split 버튼 물리 클릭
			await physicalClick(client, input, '.lumina-chat__header button:has(svg.lumina-split-chat)');
			const headerMountOk = await client.evaluate(`(async () => {
				const deadline = Date.now() + 3500;
				while (Date.now() < deadline) {
					if (document.querySelector('.lumina-split-root')) return true;
					await new Promise((r) => setTimeout(r, 100));
				}
				return false;
			})()`);
			await client.evaluate(`app.workspace.getLeavesOfType('lumina-split-chat').forEach((l) => l.detach());`);
			await sleep(200);

			// /arena 슬래시 명령어 실제 클릭 실행으로 SplitChatView 오픈
			const slashOpenOk = await client.evaluate(`(async () => {
				const textarea = document.querySelector('.lumina-chat-view textarea');
				if (!textarea) return false;
				const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
				setter.call(textarea, '/arena');
				textarea.dispatchEvent(new Event('input', { bubbles: true }));
				await new Promise((r) => setTimeout(r, 200));
				const arenaItem = Array.from(document.querySelectorAll('.lumina-popup-selector__item')).find(
					(el) => (el.textContent || '').includes('/arena'),
				);
				arenaItem?.click();
				const deadline = Date.now() + 3500;
				while (Date.now() < deadline) {
					if (document.querySelector('.lumina-split-root')) return true;
					await new Promise((r) => setTimeout(r, 100));
				}
				return false;
			})()`);

			reporter.record(
				'Split Chat Entry Points (Physical Header Button Click & /arena Slash Execution)',
				headerMountOk && slashOpenOk,
				`HeaderPhysicalClick=${headerMountOk}, /arenaSlashOpen=${slashOpenOk}`,
				Date.now() - tEntry,
			);

			// 2. 슬롯 경계 (2 -> 3 -> 4 최대, 4 -> 3 -> 2 최소) & Temperature 오버라이드 영속화
			const tSlots = Date.now();
			const slotCheck = await client.evaluate(`(async () => {
				const root = document.querySelector('.lumina-split-root');
				if (!root) return { success: false, reason: 'Split root missing' };

				const getSlotCount = () => root.querySelectorAll('.lumina-split-slotbar__cell').length;
				const addBtn = root.querySelector('.lumina-split-header__add-btn');
				const count2 = getSlotCount();
				addBtn?.click();
				await new Promise((r) => setTimeout(r, 120));
				const count3 = getSlotCount();
				addBtn?.click();
				await new Promise((r) => setTimeout(r, 120));
				const count4 = getSlotCount();
				const disabledAtMax = Boolean(addBtn?.disabled);

				// 4 -> 2 제거
				let removeBtns = root.querySelectorAll('.lumina-split-slotbar__remove-btn');
				removeBtns[removeBtns.length - 1]?.click();
				await new Promise((r) => setTimeout(r, 120));
				removeBtns = root.querySelectorAll('.lumina-split-slotbar__remove-btn');
				removeBtns[removeBtns.length - 1]?.click();
				await new Promise((r) => setTimeout(r, 120));
				const backTo2 = getSlotCount();
				const removeHiddenAtMin = root.querySelectorAll('.lumina-split-slotbar__remove-btn').length === 0;

				// Slot A 온도 오버라이드 (1.5)
				const tempBtn = root.querySelector('.lumina-split-slotbar__cell .lumina-split-slotbar__tool-btn');
				tempBtn?.click();
				await new Promise((r) => setTimeout(r, 150));
				const rangeInput = root.querySelector('.lumina-split-slotbar__temp-popover input[type="range"]');
				if (rangeInput) {
					const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
					setter.call(rangeInput, '1.5');
					rangeInput.dispatchEvent(new Event('input', { bubbles: true }));
				}
				await new Promise((r) => setTimeout(r, 200));
				tempBtn?.click();

				const lumina = app.plugins.plugins['lumina'];
				const savedTemp = lumina?.settings?.chat?.splitChat?.lastSlots?.[0]?.temperatureOverride;
				const tempOverriddenClass = Boolean(tempBtn?.classList.contains('is-overridden'));

				return {
					success:
						count2 === 2 &&
						count3 === 3 &&
						count4 === 4 &&
						disabledAtMax &&
						backTo2 === 2 &&
						removeHiddenAtMin &&
						savedTemp === 1.5 &&
						tempOverriddenClass,
					count2,
					count3,
					count4,
					disabledAtMax,
					backTo2,
					removeHiddenAtMin,
					savedTemp,
				};
			})()`);

			reporter.record(
				'Split Chat Slot Bounds (2..4) & Per-Slot Temperature Persistence',
				slotCheck.success,
				`Slots=${slotCheck.count2}->${slotCheck.count3}->${slotCheck.count4}(disabled=${slotCheck.disabledAtMax})->${slotCheck.backTo2}(noRemove=${slotCheck.removeHiddenAtMin}), Temp=${slotCheck.savedTemp}`,
				Date.now() - tSlots,
			);

			// 3. 병렬 스트리밍, 부분 실패 격리, 단일 재시도, ⚡Fastest, 프롬프트 수정 재전송
			const tStream = Date.now();
			mockServer.clearRequests();
			mockServer.setFailOnce('mock-error');

			// Slot A=mock-model-a, Slot B=mock-error 선택
			await client.evaluate(`(async () => {
				const root = document.querySelector('.lumina-split-root');
				const cells = root.querySelectorAll('.lumina-split-slotbar__cell');
				const pickModel = async (cell, modelId) => {
					cell.querySelector('.lumina-model-selector__trigger')?.click();
					await new Promise((r) => setTimeout(r, 120));
					const item = Array.from(cell.querySelectorAll('.lumina-popup-selector__item')).find(
						(el) => (el.querySelector('.lumina-popup-selector__item-name')?.textContent || '').trim() === modelId,
					);
					item?.click();
					await new Promise((r) => setTimeout(r, 120));
				};
				await pickModel(cells[0], 'mock-model-a');
				await pickModel(cells[1], 'mock-error');
			})()`);

			await sendSplitPromptPhysically(client, input, 'E2E_SPLIT_STREAM_PROMPT');

			const streamOutcome = await client.evaluate(`(async () => {
				const root = document.querySelector('.lumina-split-root');
				const deadline = Date.now() + 8000;
				while (Date.now() < deadline) {
					const cards = root.querySelectorAll('.lumina-split-card');
					const cardAText = cards[0]?.querySelector('.lumina-split-card__content')?.textContent || '';
					const cardBErr = cards[1]?.querySelector('.lumina-split-card__error');
					const retryBtn = cards[1]?.querySelector('.lumina-split-card__retry-inline');
					if (cardAText.includes('[RESP:mock-model-a]') && cardBErr && retryBtn) {
						return { slotAOk: true, slotBIsolatedError: true };
					}
					await new Promise((r) => setTimeout(r, 100));
				}
				return { slotAOk: false, slotBIsolatedError: false };
			})()`);

			// 단일 재시도 -> 성공 + Fastest 배지 확인
			let retryAndEditOk = { retryOk: false, fastestShown: false, editResentOk: false };
			if (streamOutcome.slotAOk && streamOutcome.slotBIsolatedError) {
				await physicalClick(client, input, '.lumina-split-card:nth-child(2) .lumina-split-card__retry-inline');
				retryAndEditOk = await client.evaluate(`(async () => {
					const root = document.querySelector('.lumina-split-root');
					let retryOk = false;
					let fastestShown = false;
					const deadline = Date.now() + 8000;
					while (Date.now() < deadline) {
						const cards = root.querySelectorAll('.lumina-split-card');
						const cardBText = cards[1]?.querySelector('.lumina-split-card__content')?.textContent || '';
						if (
							cardBText.includes('[RESP:mock-error]') &&
							!cards[1]?.querySelector('.lumina-split-card__error') &&
							!root.querySelector('.lumina-split-card__stop-btn')
						) {
							retryOk = true;
							fastestShown = !!root.querySelector('.lumina-split-card__fastest');
							break;
						}
						await new Promise((r) => setTimeout(r, 100));
					}

					// 프롬프트 수정 후 재전송 (ConfirmModal 자동 수락 포함)
					const editBtns = root.querySelectorAll('.lumina-split-turn__prompt-btn');
					editBtns[1]?.click();
					let editTa = null;
					const taDead = Date.now() + 1500;
					while (Date.now() < taDead) {
						editTa = root.querySelector('.lumina-message__edit-textarea');
						if (editTa) break;
						await new Promise((r) => setTimeout(r, 60));
					}
					if (editTa) {
						editTa.focus();
						const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
						setter.call(editTa, 'E2E_SPLIT_EDITED_PROMPT');
						editTa.dispatchEvent(new Event('input', { bubbles: true }));
						editTa.dispatchEvent(new Event('change', { bubbles: true }));
						await new Promise((r) => setTimeout(r, 120));
					}
					const primarySaveBtn = root.querySelector('.lumina-message__edit-btn--primary');
					primarySaveBtn?.click();
					let confirmClicked = false;
					const cmDead = Date.now() + 2500;
					while (Date.now() < cmDead) {
						const modals = document.querySelectorAll('.modal-container');
						const topModal = modals[modals.length - 1];
						const confirmBtn = topModal?.querySelector('button.mod-cta, button.mod-warning');
						if (confirmBtn) {
							confirmBtn.click();
							confirmClicked = true;
							break;
						}
						await new Promise((r) => setTimeout(r, 60));
					}

					let editResentOk = false;
					let lastTA = '';
					let lastTB = '';
					const editDeadline = Date.now() + 8000;
					while (Date.now() < editDeadline) {
						const promptTxt = root.querySelector('.lumina-split-turn__prompt-text')?.textContent || '';
						const cards = root.querySelectorAll('.lumina-split-card');
						lastTA = cards[0]?.querySelector('.lumina-split-card__content')?.textContent || '';
						lastTB = cards[1]?.querySelector('.lumina-split-card__content')?.textContent || '';
						const anyStop = !!root.querySelector('.lumina-split-card__stop-btn');
						if (
							!anyStop &&
							promptTxt.includes('E2E_SPLIT_EDITED_PROMPT') &&
							lastTA.includes('E2E_SPLIT_EDITED_PROMPT') &&
							lastTB.includes('E2E_SPLIT_EDITED_PROMPT')
						) {
							editResentOk = true;
							break;
						}
						await new Promise((r) => setTimeout(r, 100));
					}
					return {
						retryOk,
						fastestShown,
						editResentOk,
						editBtnCount: editBtns.length,
						editTaOk: Boolean(editTa),
						confirmClicked,
						lastTA: lastTA.slice(0, 60),
						lastTB: lastTB.slice(0, 60),
					};
				})()`);
			}

			const tempSentToServer = mockServer.getChatRequests().some(
				(r) => r.model === 'mock-model-a' && r.temperature === 1.5,
			);

			reporter.record(
				'Split Chat Parallel Streaming, Error Isolation, Single Retry, Fastest Badge & Turn Edit',
				streamOutcome.slotAOk &&
					streamOutcome.slotBIsolatedError &&
					retryAndEditOk.retryOk &&
					retryAndEditOk.fastestShown &&
					retryAndEditOk.editResentOk &&
					tempSentToServer,
				`StreamA=${streamOutcome.slotAOk}, ErrorIsolatedB=${streamOutcome.slotBIsolatedError}, RetryB=${retryAndEditOk.retryOk}, Fastest=${retryAndEditOk.fastestShown}, EditResend=${retryAndEditOk.editResentOk}(btns=${retryAndEditOk.editBtnCount},ta=${retryAndEditOk.editTaOk},cf=${retryAndEditOk.confirmClicked},A=${retryAndEditOk.lastTA},B=${retryAndEditOk.lastTB}), Temp1.5=${tempSentToServer}`,
				Date.now() - tStream,
			);

			// 4. 개별 슬롯 스트리밍 중단 (mock-slow -> stop-btn)
			const tAbort = Date.now();
			await client.evaluate(`(async () => {
				const root = document.querySelector('.lumina-split-root');
				const cellB = root.querySelectorAll('.lumina-split-slotbar__cell')[1];
				cellB.querySelector('.lumina-model-selector__trigger')?.click();
				await new Promise((r) => setTimeout(r, 120));
				const slowItem = Array.from(cellB.querySelectorAll('.lumina-popup-selector__item')).find(
					(el) => (el.querySelector('.lumina-popup-selector__item-name')?.textContent || '').trim() === 'mock-slow',
				);
				slowItem?.click();
			})()`);
			await sleep(150);

			await sendSplitPromptPhysically(client, input, 'E2E_ABORT_SLOW_TURN');

			const abortResult = await client.evaluate(`(async () => {
				const root = document.querySelector('.lumina-split-root');
				let stopClicked = false;
				const stopDeadline = Date.now() + 4000;
				while (Date.now() < stopDeadline) {
					const turns = root.querySelectorAll('.lumina-split-turn');
					const lastTurn = turns[turns.length - 1];
					const slowStopBtn = lastTurn?.querySelectorAll('.lumina-split-card')[1]?.querySelector('.lumina-split-card__stop-btn');
					if (slowStopBtn) {
						slowStopBtn.click();
						stopClicked = true;
						break;
					}
					await new Promise((r) => setTimeout(r, 60));
				}

				let abortedPillOk = false;
				let slotACompleted = false;
				let cardBDebug = '';
				const settleDeadline = Date.now() + 6000;
				while (Date.now() < settleDeadline) {
					const turns = root.querySelectorAll('.lumina-split-turn');
					const lastTurn = turns[turns.length - 1];
					const cards = lastTurn?.querySelectorAll('.lumina-split-card') || [];
					const aText = cards[0]?.querySelector('.lumina-split-card__content')?.textContent || '';
					const bAborted = !!cards[1]?.querySelector('.lumina-split-card__aborted-pill');
					cardBDebug = (cards[1]?.querySelector('.lumina-split-card__status')?.textContent || '') + '|' + (cards[1]?.querySelector('.lumina-split-card__content')?.textContent || '').slice(0, 40);
					if (aText.includes('[RESP:mock-model-a]')) slotACompleted = true;
					if (bAborted) abortedPillOk = true;
					if (slotACompleted && abortedPillOk) break;
					await new Promise((r) => setTimeout(r, 100));
				}
				return { stopClicked, abortedPillOk, slotACompleted, cardBDebug };
			})()`);

			reporter.record(
				'Split Chat Individual Slot Stream Abort (mock-slow)',
				abortResult.stopClicked && abortResult.abortedPillOk && abortResult.slotACompleted,
				`StopClicked=${abortResult.stopClicked}, AbortedPill=${abortResult.abortedPillOk}, SlotACompleted=${abortResult.slotACompleted}${abortResult.abortedPillOk ? '' : ` (cardB=${abortResult.cardBDebug})`}`,
				Date.now() - tAbort,
			);

			// 5. Blind Arena 마스킹·투표·공개 + Winner Context 2턴째 맥락 상속 검증
			const tArena = Date.now();
			await client.evaluate(`(async () => {
				const root = document.querySelector('.lumina-split-root');
				// 새 비교 시작 (마지막 icon-btn)
				const rightIcons = root.querySelectorAll('.lumina-split-header__right .lumina-split-header__icon-btn');
				rightIcons[rightIcons.length - 1]?.click();
				await new Promise((r) => setTimeout(r, 150));

				const cellB = root.querySelectorAll('.lumina-split-slotbar__cell')[1];
				cellB.querySelector('.lumina-model-selector__trigger')?.click();
				await new Promise((r) => setTimeout(r, 120));
				const itemB = Array.from(cellB.querySelectorAll('.lumina-popup-selector__item')).find(
					(el) => (el.querySelector('.lumina-popup-selector__item-name')?.textContent || '').trim() === 'mock-model-b',
				);
				itemB?.click();
				await new Promise((r) => setTimeout(r, 120));

				// Blind + Winner 모드 활성화
				root.querySelectorAll('.lumina-split-header__left .lumina-split-header__seg-btn')[1]?.click();
				root.querySelectorAll('.lumina-split-header__context-group .lumina-split-header__seg-btn')[1]?.click();
			})()`);
			await sleep(150);

			await sendSplitPromptPhysically(client, input, 'E2E_ARENA_ROUND_1');

			const round1Check = await client.evaluate(`(async () => {
				const root = document.querySelector('.lumina-split-root');
				const deadline = Date.now() + 8000;
				while (Date.now() < deadline) {
					const voteBar = root.querySelector('.lumina-split-turn__vote-bar');
					if (voteBar) {
						const titles = Array.from(root.querySelectorAll('.lumina-split-card__model')).map((el) => el.textContent || '');
						const isMasked = titles.every((t) => !t.includes('mock-model-a') && !t.includes('mock-model-b'));
						// 첫 번째 모델 투표 -> 정체 공개 & 승자 배지 확인
						voteBar.querySelector('.lumina-split-turn__vote-btn')?.click();
						await new Promise((r) => setTimeout(r, 200));
						const revealedTitles = Array.from(root.querySelectorAll('.lumina-split-card__model')).map((el) => el.textContent || '');
						const isRevealed = revealedTitles.some((t) => t.includes('mock-model-a')) && revealedTitles.some((t) => t.includes('mock-model-b'));
						const winnerCard = root.querySelector('.lumina-split-card.is-winner');
						const winnerText = winnerCard?.querySelector('.lumina-split-card__content')?.textContent || '';
						return {
							ok: isMasked && isRevealed && !!winnerCard && winnerText.includes('[RESP:'),
							isMasked,
							isRevealed,
							winnerModel: winnerCard?.querySelector('.lumina-split-card__model')?.textContent || '',
						};
					}
					await new Promise((r) => setTimeout(r, 100));
				}
				return { ok: false, isMasked: false, isRevealed: false, winnerModel: '' };
			})()`);

			// 2라운드 전송 시 Winner Context가 양쪽 모델 히스토리에 모두 주입되는지 서버 요청 직접 검증
			mockServer.clearRequests();
			if (round1Check.ok) {
				await sendSplitPromptPhysically(client, input, 'E2E_ARENA_ROUND_2');
				await client.evaluate(`(async () => {
					const root = document.querySelector('.lumina-split-root');
					const deadline = Date.now() + 8000;
					while (Date.now() < deadline) {
						const turns = root.querySelectorAll('.lumina-split-turn');
						if (turns.length >= 2) {
							const cards = turns[1].querySelectorAll('.lumina-split-card');
							const done0 = (cards[0]?.querySelector('.lumina-split-card__content')?.textContent || '').includes('E2E_ARENA_ROUND_2');
							const done1 = (cards[1]?.querySelector('.lumina-split-card__content')?.textContent || '').includes('E2E_ARENA_ROUND_2');
							if (done0 && done1) break;
						}
						await new Promise((r) => setTimeout(r, 100));
					}
				})()`);
			}

			const round2Reqs = mockServer.getChatRequests().filter(
				(r) => r.stream && r.messages.some((m) => String(m.content || '').includes('E2E_ARENA_ROUND_2')),
			);
			const winnerTag = `[RESP:${round1Check.winnerModel}]`;
			const winnerInheritedByBoth =
				round2Reqs.length === 2 &&
				round2Reqs.every((r) =>
					r.messages.some((m) => m.role === 'assistant' && String(m.content || '').includes(winnerTag)),
				);

			reporter.record(
				'Split Chat Blind Arena (Mask -> Vote -> Reveal) & Winner Context Round-2 Inheritance',
				round1Check.ok && winnerInheritedByBoth,
				`Masked=${round1Check.isMasked}, Revealed=${round1Check.isRevealed}, Winner=${round1Check.winnerModel}, Round2InheritedBoth=${winnerInheritedByBoth}`,
				Date.now() - tArena,
			);

			// 6. Focus Modal, Export Markdown, History CRUD(저장/검색/이름변경/복원/삭제) & Single Chat 승격
			const tActions = Date.now();
			const actionsResult = await client.evaluate(`(async () => {
				const root = document.querySelector('.lumina-split-root');
				if (!root) return { success: false };

				// 6-A. Focus Modal 열기
				const firstCard = root.querySelector('.lumina-split-card');
				const expandBtn = firstCard?.querySelectorAll('.lumina-split-card__action-btn');
				expandBtn?.[expandBtn.length - 1]?.click();
				await new Promise((r) => setTimeout(r, 200));
				const focusModalOpened = !!root.querySelector('.lumina-split-focus-modal');
				return { focusModalOpened };
			})()`);

			// Escape 물리 키로 Focus Modal 닫기
			await input.pressEscape();
			await sleep(200);

			const crudAndPromote = await client.evaluate(`(async () => {
				const root = document.querySelector('.lumina-split-root');
				const focusModalClosed = !root?.querySelector('.lumina-split-focus-modal');

				// 6-B. 마크다운 내보내기
				const rightIcons = root.querySelectorAll('.lumina-split-header__right .lumina-split-header__icon-btn');
				const exportBtn = rightIcons[0];
				exportBtn?.click();
				let exportedPath = null;
				const expDeadline = Date.now() + 4000;
				while (Date.now() < expDeadline) {
					const found = app.vault.getMarkdownFiles().find((f) => f.path.startsWith('Lumina Exports/') && f.name.includes('[Arena]'));
					if (found) {
						exportedPath = found.path;
						break;
					}
					await new Promise((r) => setTimeout(r, 100));
				}
				if (exportedPath) {
					app.workspace.getLeavesOfType('markdown').forEach((l) => {
						if (l.view?.file?.path === exportedPath) l.detach();
					});
					const ef = app.vault.getAbstractFileByPath(exportedPath);
					if (ef) await app.vault.delete(ef, true);
				}

				// 6-C. 히스토리 드로어: 로드 -> 검색 -> 이름 변경 -> 새 비교 -> 복원 -> 삭제
				const historyToggle = root.querySelector('.lumina-split-header__left .lumina-split-header__icon-btn');
				historyToggle?.click();
				let sessionCount = 0;
				const histDeadline = Date.now() + 4000;
				while (Date.now() < histDeadline) {
					sessionCount = root.querySelectorAll('.lumina-split-drawer__item').length;
					if (sessionCount > 0) break;
					await new Promise((r) => setTimeout(r, 100));
				}

				// 이름 변경
				const firstItem = root.querySelector('.lumina-split-drawer__item');
				firstItem?.querySelector('.lumina-split-drawer__actions button')?.click();
				await new Promise((r) => setTimeout(r, 150));
				const renameInput = root.querySelector('.lumina-split-drawer__rename-input');
				if (renameInput) {
					const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
					setter.call(renameInput, 'Renamed E2E Arena');
					renameInput.dispatchEvent(new Event('input', { bubbles: true }));
					root.querySelector('.lumina-split-drawer__rename-box button')?.click();
				}
				await new Promise((r) => setTimeout(r, 300));

				// 검색 필터
				const searchInput = root.querySelector('.lumina-split-drawer__search-input');
				if (searchInput) {
					const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
					setter.call(searchInput, 'Renamed E2E Arena');
					searchInput.dispatchEvent(new Event('input', { bubbles: true }));
				}
				await new Promise((r) => setTimeout(r, 150));
				const renameMatched = Array.from(root.querySelectorAll('.lumina-split-drawer__item-title')).some(
					(el) => (el.textContent || '').includes('Renamed E2E Arena'),
				);

				// 새 비교로 초기화 후 복원
				root.querySelector('.lumina-split-drawer__new-btn')?.click();
				await new Promise((r) => setTimeout(r, 150));
				const clearedTurns = root.querySelectorAll('.lumina-split-turn').length === 0;
				root.querySelector('.lumina-split-drawer__item')?.click();
				await new Promise((r) => setTimeout(r, 300));
				const restoredTurns = root.querySelectorAll('.lumina-split-turn').length > 0;

				// 6-D. 단일 채팅 승격 (Continue in Chat)
				const firstCardActions = root.querySelectorAll('.lumina-split-card')[0]?.querySelectorAll('.lumina-split-card__action-btn') || [];
				// [copy, saveAsNote, retry, continueInChat, expand]
				const promoteBtn = firstCardActions[firstCardActions.length - 2];
				promoteBtn?.click();
				let promotedToChat = false;
				const chatDeadline = Date.now() + 4000;
				while (Date.now() < chatDeadline) {
					const chatLeaves = app.workspace.getLeavesOfType('lumina-chat');
					const chatText = document.querySelector('.lumina-chat-view')?.textContent || '';
					if (chatLeaves.length > 0 && chatText.includes('[RESP:')) {
						promotedToChat = true;
						break;
					}
					await new Promise((r) => setTimeout(r, 100));
				}

				// Split 다시 포커스 후 히스토리 세션 삭제 (ConfirmModal 수락)
				const splitLeaf = app.workspace.getLeavesOfType('lumina-split-chat')[0];
				if (splitLeaf) app.workspace.setActiveLeaf(splitLeaf, { focus: true });
				await new Promise((r) => setTimeout(r, 150));
				const delBtn = root.querySelector('.lumina-split-drawer__action-btn--delete');
				delBtn?.click();
				await new Promise((r) => setTimeout(r, 150));
				document.querySelector('.modal-container button.mod-warning, .modal-container button.mod-cta')?.click();
				await new Promise((r) => setTimeout(r, 300));
				const deletedCleanly = !Array.from(root.querySelectorAll('.lumina-split-drawer__item-title')).some(
					(el) => (el.textContent || '').includes('Renamed E2E Arena'),
				);

				return {
					focusModalClosed,
					exportedOk: Boolean(exportedPath),
					sessionFound: sessionCount > 0,
					renameMatched,
					clearedTurns,
					restoredTurns,
					promotedToChat,
					deletedCleanly,
				};
			})()`);

			reporter.record(
				'Split Chat Focus Modal, Export Markdown, History CRUD & Promote to Single Chat',
				actionsResult.focusModalOpened &&
					crudAndPromote.focusModalClosed &&
					crudAndPromote.exportedOk &&
					crudAndPromote.sessionFound &&
					crudAndPromote.renameMatched &&
					crudAndPromote.clearedTurns &&
					crudAndPromote.restoredTurns &&
					crudAndPromote.promotedToChat &&
					crudAndPromote.deletedCleanly,
				`Focus=${actionsResult.focusModalOpened}/${crudAndPromote.focusModalClosed}, Export=${crudAndPromote.exportedOk}, Rename=${crudAndPromote.renameMatched}, Restore=${crudAndPromote.clearedTurns}->${crudAndPromote.restoredTurns}, Promote=${crudAndPromote.promotedToChat}, Delete=${crudAndPromote.deletedCleanly}`,
				Date.now() - tActions,
			);
		} catch (err) {
			reporter.record('Split Chat / Model Compare (Pro)', false, err.message, 0);
		} finally {
			await cleanupProArtifacts(client);
		}
	});
}

/**
 * SUITE 13: Batch Studio (5종 레시피, 제어, 롤백, Auto-Watch 실전 감시, Orphan Notes Pro) E2E 스위트.
 */
export async function runBatchStudioProSuite(client, input, reporter, mockServer) {
	reporter.startSuite('Batch Studio, Auto-Watch & Orphan Notes (Pro)');

	await withMockProvider(client, mockServer, async () => {
		try {
			// 1. 커맨드 오픈 + 파일 탐색기 폴더 우클릭(file-menu) 진입 확인
			const tOpen = Date.now();
			const openCheck = await client.evaluate(`(async () => {
				const lumina = app.plugins.plugins['lumina'];
				const { TFolder } = window.__luminaObsidianMod || {};
				const fakeFolder = TFolder ? Object.assign(Object.create(TFolder.prototype), { path: '__lumina_e2e_batch_test__', name: '__lumina_e2e_batch_test__' }) : { path: '__lumina_e2e_batch_test__', children: [] };
				const menuItems = [];
				app.workspace.trigger('file-menu', {
					addItem(cb) {
						const it = { title: '', setTitle(t){ this.title = t; return this; }, setIcon(){ return this; }, setSection(){ return this; }, onClick(){ return this; } };
						cb(it);
						menuItems.push(it.title);
						return this;
					},
					addSeparator() { return this; },
				}, fakeFolder);

				app.workspace.getLeavesOfType('lumina-batch-studio').forEach((l) => l.detach());
				app.commands.executeCommandById('lumina:open-batch-studio');
				const deadline = Date.now() + 4000;
				while (Date.now() < deadline) {
					if (document.querySelector('div.lumina-batch-studio')) break;
					await new Promise((r) => setTimeout(r, 100));
				}
				const studio = document.querySelector('div.lumina-batch-studio');
				return {
					hasFileMenuEntry: menuItems.some((t) => t.includes('Lumina')),
					leafCount: app.workspace.getLeavesOfType('lumina-batch-studio').length,
					hasStudio: !!studio,
					hasProBadge: !!studio?.querySelector('.lumina-batch-pro-badge'),
					recipeCount: studio?.querySelectorAll('.lumina-batch-recipe-tab').length || 0,
					mainTabCount: studio?.querySelectorAll('.lumina-batch-main-tab').length || 0,
					hasStatusBar: !!document.querySelector('.status-bar-item.lumina-watch-statusbar') || !lumina?.folderWatchManager,
				};
			})()`);

			reporter.record(
				'Open Batch Studio, Folder Context Menu & StatusBar Registration',
				openCheck.hasFileMenuEntry &&
					openCheck.leafCount > 0 &&
					openCheck.hasStudio &&
					openCheck.hasProBadge &&
					openCheck.recipeCount === 5 &&
					openCheck.mainTabCount === 4 &&
					openCheck.hasStatusBar,
				`FileMenu=${openCheck.hasFileMenuEntry}, Recipes=${openCheck.recipeCount}, MainTabs=${openCheck.mainTabCount}, ProBadge=${openCheck.hasProBadge}`,
				Date.now() - tOpen,
			);

			// 2. Autolink: 샘플 테스트 -> 3건 실행 -> 큐 필터 -> 1건 거절 -> 1건 개별 수락(Auto-Advance) -> 남은 1건 일괄 적용 -> 롤백
			const tAutolink = Date.now();
			const alphaOrig = 'This E2E test note mentions LuminaBatchBeta and LuminaBatchGamma in plain text for autolink detection.';
			const betaOrig = 'This E2E test note mentions LuminaBatchAlpha in plain text for autolink detection.';
			const gammaOrig = 'This E2E test note mentions LuminaBatchAlpha in plain text for autolink detection (to be rejected).';

			await client.evaluate(`(async () => {
				const folder = '__lumina_e2e_batch_test__';
				const ex = app.vault.getAbstractFileByPath(folder);
				if (ex) await app.vault.delete(ex, true);
				await app.vault.createFolder(folder);
				await app.vault.create(folder + '/LuminaBatchAlpha.md', ${JSON.stringify(alphaOrig)});
				await app.vault.create(folder + '/LuminaBatchBeta.md', ${JSON.stringify(betaOrig)});
				await app.vault.create(folder + '/LuminaBatchGamma.md', ${JSON.stringify(gammaOrig)});
			})()`);
			await sleep(400);

			const autolinkRes = await client.evaluate(`(async () => {
				const studio = document.querySelector('div.lumina-batch-studio');
				const mainTabs = studio.querySelectorAll('.lumina-batch-main-tab');
				mainTabs[0]?.click();
				await new Promise((r) => setTimeout(r, 100));
				studio.querySelector('.lumina-batch-collapsed-bar button')?.click();
				await new Promise((r) => setTimeout(r, 100));

				studio.querySelectorAll('.lumina-batch-recipe-tab')[1]?.click();
				await new Promise((r) => setTimeout(r, 150));
				studio.querySelectorAll('.lumina-batch-segmented button')[1]?.click();
				await new Promise((r) => setTimeout(r, 100));

				const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
				const folderInput = studio.querySelector('input[list="lumina-batch-folder-list"]');
				if (folderInput) {
					setter.call(folderInput, '__lumina_e2e_batch_test__');
					folderInput.dispatchEvent(new Event('input', { bubbles: true }));
				}
				const tagInput = studio.querySelector('.lumina-batch-field-split input[type="text"]');
				if (tagInput && tagInput.value) {
					setter.call(tagInput, '');
					tagInput.dispatchEvent(new Event('input', { bubbles: true }));
				}
				await new Promise((r) => setTimeout(r, 300));

				// 샘플 테스트
				studio.querySelector('.lumina-batch-sample-box button.lumina-batch-btn')?.click();
				let sampleMatched = false;
				const sDead = Date.now() + 5000;
				while (Date.now() < sDead) {
					const lines = Array.from(studio.querySelectorAll('.lumina-batch-sample-preview .lumina-batch-diff-line.is-added'));
					if (lines.some((el) => (el.textContent || '').includes('[[LuminaBatch'))) {
						sampleMatched = true;
						break;
					}
					await new Promise((r) => setTimeout(r, 100));
				}

				// 전체 배치 실행
				studio.querySelector('.lumina-batch-start-btn')?.click();
				const rDead = Date.now() + 8000;
				while (Date.now() < rDead) {
					if (studio.querySelector('.lumina-batch-status-pill.is-completed')) break;
					await new Promise((r) => setTimeout(r, 100));
				}

				// Staged 필터 전환 및 3건 확인
				studio.querySelectorAll('.lumina-batch-filter-tab')[1]?.click();
				await new Promise((r) => setTimeout(r, 100));
				const queueCount = studio.querySelectorAll('.lumina-batch-queue-item').length;

				// Gamma 선택 후 거절
				const gammaItem = Array.from(studio.querySelectorAll('.lumina-batch-queue-item')).find(
					(el) => (el.textContent || '').includes('Gamma'),
				);
				gammaItem?.click();
				await new Promise((r) => setTimeout(r, 100));
				studio.querySelectorAll('.lumina-batch-inspector-footer__single button')[0]?.click();
				await new Promise((r) => setTimeout(r, 150));

				// Alpha 선택 후 개별 수락 -> Auto-Advance로 Beta 포커스 이동 확인
				const alphaItem = Array.from(studio.querySelectorAll('.lumina-batch-queue-item')).find(
					(el) => (el.textContent || '').includes('Alpha'),
				);
				alphaItem?.click();
				await new Promise((r) => setTimeout(r, 100));
				studio.querySelectorAll('.lumina-batch-inspector-footer__single button')[1]?.click();
				await new Promise((r) => setTimeout(r, 300));
				const advancedToBeta = (studio.querySelector('.lumina-batch-inspector-title')?.textContent || '').includes('Beta');

				// 남은 Beta 일괄 적용
				studio.querySelector('.lumina-batch-bulk-apply-btn')?.click();
				let appliedCorrectly = false;
				const aDead = Date.now() + 5000;
				while (Date.now() < aDead) {
					const cA = await app.vault.read(app.vault.getAbstractFileByPath('__lumina_e2e_batch_test__/LuminaBatchAlpha.md'));
					const cB = await app.vault.read(app.vault.getAbstractFileByPath('__lumina_e2e_batch_test__/LuminaBatchBeta.md'));
					const cG = await app.vault.read(app.vault.getAbstractFileByPath('__lumina_e2e_batch_test__/LuminaBatchGamma.md'));
					if (cA.includes('[[LuminaBatchBeta]]') && cB.includes('[[LuminaBatchAlpha]]') && !cG.includes('[[')) {
						appliedCorrectly = true;
						break;
					}
					await new Promise((r) => setTimeout(r, 100));
				}

				// 히스토리 롤백 (일괄 + 개별 히스토리 모두 롤백)
				studio.querySelector('.lumina-batch-main-tab[data-tab="history"]')?.click();
				await new Promise((r) => setTimeout(r, 200));
				const cards = studio.querySelectorAll('.lumina-batch-history-card');
				for (const card of cards) {
					const btn = card.querySelector('button.lumina-batch-btn');
					if (btn) {
						btn.click();
						await new Promise((r) => setTimeout(r, 100));
						card.querySelector('.lumina-batch-confirm-inline button.mod-warning')?.click();
						await new Promise((r) => setTimeout(r, 250));
					}
				}
				const cAAfter = await app.vault.read(app.vault.getAbstractFileByPath('__lumina_e2e_batch_test__/LuminaBatchAlpha.md'));
				const cBAfter = await app.vault.read(app.vault.getAbstractFileByPath('__lumina_e2e_batch_test__/LuminaBatchBeta.md'));
				const rolledBackOk = !cAAfter.includes('[[') && !cBAfter.includes('[[');

				return {
					success: sampleMatched && queueCount === 3 && advancedToBeta && appliedCorrectly && rolledBackOk,
					sampleMatched,
					queueCount,
					advancedToBeta,
					appliedCorrectly,
					rolledBackOk,
				};
			})()`);

			reporter.record(
				'Batch Studio Autolink (Sample, Filter, Reject, Single Auto-Advance, Bulk Apply & Rollback)',
				autolinkRes.success,
				`Sample=${autolinkRes.sampleMatched}, Queue=${autolinkRes.queueCount}, AutoAdvance=${autolinkRes.advancedToBeta}, Applied=${autolinkRes.appliedCorrectly}, Rollback=${autolinkRes.rolledBackOk}`,
				Date.now() - tAutolink,
			);

			// 3. LLM 레시피 3종 (frontmatter + 인라인 태그 편집, summary-callout, custom-prompt)
			const tLlmRecipes = Date.now();
			const llmRecipesRes = await client.evaluate(`(async () => {
				const studio = document.querySelector('div.lumina-batch-studio');
				const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
				const taSetter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
				const selSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;

				const ensureWorkspaceExpanded = async () => {
					studio.querySelector('.lumina-batch-main-tab[data-tab="workspace"]')?.click();
					await new Promise((r) => setTimeout(r, 120));
					studio.querySelector('.lumina-batch-collapsed-bar button')?.click();
					await new Promise((r) => setTimeout(r, 120));
				};

				const rollbackTopHistory = async () => {
					studio.querySelector('.lumina-batch-main-tab[data-tab="history"]')?.click();
					await new Promise((r) => setTimeout(r, 150));
					const card = studio.querySelector('.lumina-batch-history-card');
					card?.querySelector('button.lumina-batch-btn')?.click();
					await new Promise((r) => setTimeout(r, 100));
					card?.querySelector('.lumina-batch-confirm-inline button.mod-warning')?.click();
					await new Promise((r) => setTimeout(r, 250));
				};

				// 3-A. Frontmatter 레시피 + 인라인 태그 추가/삭제
				await ensureWorkspaceExpanded();
				studio.querySelectorAll('.lumina-batch-recipe-tab')[0]?.click();
				await new Promise((r) => setTimeout(r, 150));
				const folderInput = studio.querySelector('input[list="lumina-batch-folder-list"]');
				if (folderInput) {
					setter.call(folderInput, '__lumina_e2e_batch_test__');
					folderInput.dispatchEvent(new Event('input', { bubbles: true }));
				}
				await new Promise((r) => setTimeout(r, 250));
				studio.querySelector('.lumina-batch-start-btn')?.click();
				let fmDone = false;
				const fmDead = Date.now() + 8000;
				while (Date.now() < fmDead) {
					if (studio.querySelector('.lumina-batch-status-pill.is-completed') && studio.querySelector('.lumina-batch-tag-add')) {
						fmDone = true;
						break;
					}
					await new Promise((r) => setTimeout(r, 100));
				}

				// 인스펙터에서 커스텀 태그 인라인 추가 및 첫 태그 제거
				const addTagInput = studio.querySelector('.lumina-batch-tag-add input');
				if (addTagInput) {
					setter.call(addTagInput, 'e2e-edited-tag');
					addTagInput.dispatchEvent(new Event('input', { bubbles: true }));
					studio.querySelector('.lumina-batch-tag-add button')?.click();
				}
				await new Promise((r) => setTimeout(r, 100));
				studio.querySelector('.lumina-batch-inspector-pane .lumina-batch-tag-remove')?.click();
				await new Promise((r) => setTimeout(r, 100));
				studio.querySelector('.lumina-batch-bulk-apply-btn')?.click();
				await new Promise((r) => setTimeout(r, 400));

				const alphaFm = await app.vault.read(app.vault.getAbstractFileByPath('__lumina_e2e_batch_test__/LuminaBatchAlpha.md'));
				const fmAppliedOk = alphaFm.includes('e2e-edited-tag') && alphaFm.includes('Automated E2E generated summary description.');
				await rollbackTopHistory();

				// 3-B. Summary Callout 레시피
				await ensureWorkspaceExpanded();
				studio.querySelectorAll('.lumina-batch-recipe-tab')[2]?.click();
				await new Promise((r) => setTimeout(r, 150));
				studio.querySelector('.lumina-batch-start-btn')?.click();
				const sumDead = Date.now() + 8000;
				while (Date.now() < sumDead) {
					const txt = studio.querySelector('.lumina-batch-inspector-pane')?.textContent || '';
					if (studio.querySelector('.lumina-batch-status-pill.is-completed') && txt.includes('[!summary]')) break;
					await new Promise((r) => setTimeout(r, 100));
				}
				studio.querySelector('.lumina-batch-bulk-apply-btn')?.click();
				await new Promise((r) => setTimeout(r, 400));
				const alphaSum = await app.vault.read(app.vault.getAbstractFileByPath('__lumina_e2e_batch_test__/LuminaBatchAlpha.md'));
				const summaryAppliedOk = alphaSum.includes('> [!summary]') && alphaSum.includes('concise E2E generated summary callout');
				await rollbackTopHistory();

				// 3-C. Pro 전용 Custom Prompt 레시피 (변수 칩 클릭 + frontmatter-key 출력)
				await ensureWorkspaceExpanded();
				studio.querySelectorAll('.lumina-batch-recipe-tab')[3]?.click();
				await new Promise((r) => setTimeout(r, 150));
				studio.querySelector('.lumina-batch-var-chips .lumina-batch-chip-btn')?.click();
				await new Promise((r) => setTimeout(r, 80));
				const cpArea = studio.querySelector('.lumina-batch-card textarea.lumina-batch-textarea');
				if (cpArea) {
					taSetter.call(cpArea, 'E2E_CUSTOM_RECIPE for {{title}} in {{folder}}');
					cpArea.dispatchEvent(new Event('input', { bubbles: true }));
				}
				const outSel = studio.querySelector('.lumina-batch-options-group .lumina-batch-field-split select');
				if (outSel) {
					selSetter.call(outSel, 'frontmatter-key');
					outSel.dispatchEvent(new Event('change', { bubbles: true }));
				}
				const keyIn = studio.querySelector('.lumina-batch-options-group .lumina-batch-field-split input');
				if (keyIn) {
					setter.call(keyIn, 'e2e_custom_out');
					keyIn.dispatchEvent(new Event('input', { bubbles: true }));
				}
				await new Promise((r) => setTimeout(r, 200));
				studio.querySelector('.lumina-batch-start-btn')?.click();
				const cpDead = Date.now() + 8000;
				while (Date.now() < cpDead) {
					const txt = studio.querySelector('.lumina-batch-inspector-pane')?.textContent || '';
					if (studio.querySelector('.lumina-batch-status-pill.is-completed') && txt.includes('Custom E2E Output:')) break;
					await new Promise((r) => setTimeout(r, 100));
				}
				studio.querySelector('.lumina-batch-bulk-apply-btn')?.click();
				await new Promise((r) => setTimeout(r, 400));
				const alphaCp = await app.vault.read(app.vault.getAbstractFileByPath('__lumina_e2e_batch_test__/LuminaBatchAlpha.md'));
				const customAppliedOk = alphaCp.includes('e2e_custom_out:') && alphaCp.includes('Custom E2E Output:');
				await rollbackTopHistory();

				return {
					success: fmDone && fmAppliedOk && summaryAppliedOk && customAppliedOk,
					fmAppliedOk,
					summaryAppliedOk,
					customAppliedOk,
				};
			})()`);

			reporter.record(
				'Batch Studio LLM Recipes (Frontmatter + Tag Edit, Summary Callout, Pro Custom Prompt)',
				llmRecipesRes.success,
				`Frontmatter+TagEdit=${llmRecipesRes.fmAppliedOk}, SummaryCallout=${llmRecipesRes.summaryAppliedOk}, CustomPrompt=${llmRecipesRes.customAppliedOk}`,
				Date.now() - tLlmRecipes,
			);

			// 4. Folder Move 3종 모드 (fixed, by-tag + fallback + 충돌 회피, ai-route)
			const tMove = Date.now();
			const moveRes = await client.evaluate(`(async () => {
				const studio = document.querySelector('div.lumina-batch-studio');
				const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
				const selSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;

				for (const folder of ['__lumina_e2e_move_src__', '__lumina_e2e_move_dest__', '__lumina_e2e_move_work__', '__lumina_e2e_move_fallback__']) {
					const ex = app.vault.getAbstractFileByPath(folder);
					if (ex) await app.vault.delete(ex, true);
					await app.vault.createFolder(folder);
				}
				await app.vault.create('__lumina_e2e_move_src__/WorkNote.md', '---\\ntags: [work]\\n---\\nWork tagged note with enough length to pass filter.');
				await app.vault.create('__lumina_e2e_move_src__/MiscNote.md', 'Untagged misc note with enough length to route to fallback folder.');
				// 이름 충돌(rename-suffix) 검증용 선배치 파일
				await app.vault.create('__lumina_e2e_move_work__/WorkNote.md', 'Existing file causing rename-suffix collision.');
				await new Promise((r) => setTimeout(r, 500));

				const prepMoveTab = async (mode) => {
					studio.querySelector('.lumina-batch-main-tab[data-tab="workspace"]')?.click();
					await new Promise((r) => setTimeout(r, 100));
					studio.querySelector('.lumina-batch-collapsed-bar button')?.click();
					await new Promise((r) => setTimeout(r, 100));
					studio.querySelectorAll('.lumina-batch-recipe-tab')[4]?.click();
					await new Promise((r) => setTimeout(r, 150));
					studio.querySelectorAll('.lumina-batch-segmented button')[1]?.click();
					await new Promise((r) => setTimeout(r, 100));
					const folderIn = studio.querySelector('input[list="lumina-batch-folder-list"]');
					if (folderIn) {
						setter.call(folderIn, '__lumina_e2e_move_src__');
						folderIn.dispatchEvent(new Event('input', { bubbles: true }));
					}
					const modeSel = studio.querySelector('#lumina-batch-move-mode');
					if (modeSel) {
						selSetter.call(modeSel, mode);
						modeSel.dispatchEvent(new Event('change', { bubbles: true }));
					}
					await new Promise((r) => setTimeout(r, 200));
				};

				const runApplyAndRollback = async (verifyFn) => {
					studio.querySelector('.lumina-batch-start-btn')?.click();
					await new Promise((r) => setTimeout(r, 200));
					const rDead = Date.now() + 8000;
					while (Date.now() < rDead) {
						const hasWork = Array.from(studio.querySelectorAll('.lumina-batch-queue-item')).some(
							(el) => (el.textContent || '').includes('WorkNote'),
						);
						const applyBtn = studio.querySelector('.lumina-batch-bulk-apply-btn');
						if (
							!studio.querySelector('.lumina-batch-status-pill.is-running') &&
							studio.querySelector('.lumina-batch-status-pill.is-completed') &&
							hasWork &&
							applyBtn &&
							!applyBtn.disabled
						) {
							break;
						}
						await new Promise((r) => setTimeout(r, 100));
					}
					const queueCount = studio.querySelectorAll('.lumina-batch-queue-item').length;
					const applyBtn = studio.querySelector('.lumina-batch-bulk-apply-btn');
					applyBtn?.click();
					let ok = false;
					const vDead = Date.now() + 4000;
					while (Date.now() < vDead) {
						if (await verifyFn()) {
							ok = true;
							break;
						}
						await new Promise((r) => setTimeout(r, 120));
					}
					studio.querySelector('.lumina-batch-main-tab[data-tab="history"]')?.click();
					await new Promise((r) => setTimeout(r, 150));
					const card = studio.querySelector('.lumina-batch-history-card');
					card?.querySelector('button.lumina-batch-btn')?.click();
					await new Promise((r) => setTimeout(r, 100));
					card?.querySelector('.lumina-batch-confirm-inline button.mod-warning')?.click();
					await new Promise((r) => setTimeout(r, 400));
					return { ok, queueCount };
				};

				// 4-A. fixed
				await prepMoveTab('fixed');
				const fixedIn = studio.querySelector('#lumina-batch-move-target');
				if (fixedIn) {
					setter.call(fixedIn, '__lumina_e2e_move_dest__');
					fixedIn.dispatchEvent(new Event('input', { bubbles: true }));
				}
				await new Promise((r) => setTimeout(r, 150));
				const fixedRun = await runApplyAndRollback(async () =>
					!!app.vault.getAbstractFileByPath('__lumina_e2e_move_dest__/WorkNote.md') &&
					!!app.vault.getAbstractFileByPath('__lumina_e2e_move_dest__/MiscNote.md'),
				);
				const fixedOk = fixedRun.ok;
				const fixedRolledBack = !!app.vault.getAbstractFileByPath('__lumina_e2e_move_src__/WorkNote.md');

				// 4-B. by-tag + fallback + rename-suffix
				await prepMoveTab('by-tag');
				const tagSplitInputs = studio.querySelectorAll('.lumina-batch-options-group .lumina-batch-field-split input');
				if (tagSplitInputs[0] && tagSplitInputs[1]) {
					setter.call(tagSplitInputs[0], 'work');
					tagSplitInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
					setter.call(tagSplitInputs[1], '__lumina_e2e_move_work__');
					tagSplitInputs[1].dispatchEvent(new Event('input', { bubbles: true }));
					studio.querySelector('.lumina-batch-options-group .lumina-batch-field-split button')?.click();
				}
				const fbIn = studio.querySelector('#lumina-batch-move-fallback');
				if (fbIn) {
					setter.call(fbIn, '__lumina_e2e_move_fallback__');
					fbIn.dispatchEvent(new Event('input', { bubbles: true }));
				}
				await new Promise((r) => setTimeout(r, 150));
				const byTagRun = await runApplyAndRollback(async () =>
					!!app.vault.getAbstractFileByPath('__lumina_e2e_move_work__/WorkNote (1).md') &&
					!!app.vault.getAbstractFileByPath('__lumina_e2e_move_fallback__/MiscNote.md'),
				);
				const byTagOk = byTagRun.ok;

				// 4-C. ai-route (화이트리스트 후보 -> Mock LLM 선택)
				await prepMoveTab('ai-route');
				const candIn = studio.querySelector('.lumina-batch-options-group .lumina-batch-field-split input');
				if (candIn) {
					setter.call(candIn, '__lumina_e2e_move_dest__');
					candIn.dispatchEvent(new Event('input', { bubbles: true }));
					studio.querySelector('.lumina-batch-options-group .lumina-batch-field-split button')?.click();
				}
				await new Promise((r) => setTimeout(r, 150));
				const aiRouteRun = await runApplyAndRollback(async () =>
					!!app.vault.getAbstractFileByPath('__lumina_e2e_move_dest__/WorkNote.md') &&
					!!app.vault.getAbstractFileByPath('__lumina_e2e_move_dest__/MiscNote.md'),
				);
				const aiRouteOk = aiRouteRun.ok;

				return {
					success: fixedOk && fixedRolledBack && byTagOk && aiRouteOk,
					fixedOk,
					fixedRolledBack,
					byTagOk,
					aiRouteOk,
				};
			})()`);

			reporter.record(
				'Batch Studio Folder Move All Modes (fixed, by-tag + conflict/fallback, ai-route)',
				moveRes.success,
				`Fixed=${moveRes.fixedOk}(rb=${moveRes.fixedRolledBack}), ByTag+Collision=${moveRes.byTagOk}, AiRoute=${moveRes.aiRouteOk}`,
				Date.now() - tMove,
			);

			// 5. 실행 제어: Pause -> Resume -> Cancel
			const tControl = Date.now();
			mockServer.setBatchDelayMs(350);
			let controlRes = { pausedOk: false, resumedOk: false, cancelledOk: false };
			try {
				controlRes = await client.evaluate(`(async () => {
					const studio = document.querySelector('div.lumina-batch-studio');
					const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
					studio.querySelector('.lumina-batch-main-tab[data-tab="workspace"]')?.click();
					await new Promise((r) => setTimeout(r, 100));
					studio.querySelector('.lumina-batch-collapsed-bar button')?.click();
					await new Promise((r) => setTimeout(r, 100));
					studio.querySelectorAll('.lumina-batch-recipe-tab')[0]?.click();
					await new Promise((r) => setTimeout(r, 120));
					const folderIn = studio.querySelector('input[list="lumina-batch-folder-list"]');
					if (folderIn) {
						setter.call(folderIn, '__lumina_e2e_batch_test__');
						folderIn.dispatchEvent(new Event('input', { bubbles: true }));
					}
					await new Promise((r) => setTimeout(r, 200));
					studio.querySelector('.lumina-batch-start-btn')?.click();

					let pausedOk = false;
					let resumedOk = false;
					let cancelledOk = false;
					const deadline = Date.now() + 5000;
					while (Date.now() < deadline) {
						if (studio.querySelector('.lumina-batch-status-pill.is-running')) {
							const btns = studio.querySelectorAll('.lumina-batch-progress-actions button');
							btns[0]?.click(); // Pause
							await new Promise((r) => setTimeout(r, 150));
							pausedOk = !!studio.querySelector('.lumina-batch-status-pill.is-paused');
							if (pausedOk) {
								const pBtns = studio.querySelectorAll('.lumina-batch-progress-actions button');
								pBtns[0]?.click(); // Resume
								await new Promise((r) => setTimeout(r, 150));
								resumedOk = !!studio.querySelector('.lumina-batch-status-pill.is-running');
								const rBtns = studio.querySelectorAll('.lumina-batch-progress-actions button');
								rBtns[1]?.click(); // Cancel
								await new Promise((r) => setTimeout(r, 450));
								cancelledOk = !!studio.querySelector('.lumina-batch-status-pill.is-completed');
							}
							break;
						}
						await new Promise((r) => setTimeout(r, 40));
					}
					return { pausedOk, resumedOk, cancelledOk };
				})()`);
			} finally {
				mockServer.setBatchDelayMs(0);
			}

			reporter.record(
				'Batch Studio Execution Controls (Pause, Resume & Cancel)',
				controlRes.pausedOk && controlRes.resumedOk && controlRes.cancelledOk,
				`Paused=${controlRes.pausedOk}, Resumed=${controlRes.resumedOk}, Cancelled=${controlRes.cancelledOk}`,
				Date.now() - tControl,
			);

			// 6. Pro Auto-Watch: 실제 vault.create 이벤트 기반 자동감시(auto-stage -> 수락 -> 롤백, auto-apply, 거절/토글/삭제)
			const tWatch = Date.now();
			const watchRes = await client.evaluate(`(async () => {
				const studio = document.querySelector('div.lumina-batch-studio');
				const lumina = app.plugins.plugins['lumina'];
				const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
				const selSetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;

				for (const f of ['__lumina_e2e_watch_src__', '__lumina_e2e_watch_dest__']) {
					const ex = app.vault.getAbstractFileByPath(f);
					if (ex) await app.vault.delete(ex, true);
				}
				await app.vault.createFolder('__lumina_e2e_watch_src__');

				studio.querySelector('.lumina-batch-main-tab[data-tab="watch"]')?.click();
				await new Promise((r) => setTimeout(r, 200));
				const getWatchPane = () => studio.querySelector('.lumina-watch-pane');
				const deviceToggle = getWatchPane()?.querySelector('.lumina-watch-topbar input[type="checkbox"]');
				if (deviceToggle && !deviceToggle.checked) {
					deviceToggle.click();
					await new Promise((r) => setTimeout(r, 150));
				}

				// 새 규칙 생성: on-create, debounce=3s, frontmatter(disabled) or summary-callout -> fixed move, auto-stage
				getWatchPane()?.querySelector('.lumina-watch-topbar button.mod-cta')?.click();
				await new Promise((r) => setTimeout(r, 150));
				const editor = getWatchPane()?.querySelector('.lumina-watch-editor');
				if (!editor) return { success: false, reason: 'Watch rule editor missing' };
				setter.call(editor.querySelector('#lumina-watch-name'), 'E2E AutoWatch Rule');
				editor.querySelector('#lumina-watch-name').dispatchEvent(new Event('input', { bubbles: true }));
				setter.call(editor.querySelector('#lumina-watch-src'), '__lumina_e2e_watch_src__');
				editor.querySelector('#lumina-watch-src').dispatchEvent(new Event('input', { bubbles: true }));
				setter.call(editor.querySelector('#lumina-watch-debounce'), '3');
				editor.querySelector('#lumina-watch-debounce').dispatchEvent(new Event('input', { bubbles: true }));
				selSetter.call(editor.querySelector('#lumina-watch-movemode'), 'fixed');
				editor.querySelector('#lumina-watch-movemode').dispatchEvent(new Event('change', { bubbles: true }));
				await new Promise((r) => setTimeout(r, 100));
				setter.call(editor.querySelector('#lumina-watch-fixeddest'), '__lumina_e2e_watch_dest__');
				editor.querySelector('#lumina-watch-fixeddest').dispatchEvent(new Event('input', { bubbles: true }));
				selSetter.call(editor.querySelector('#lumina-watch-exec'), 'auto-stage');
				editor.querySelector('#lumina-watch-exec').dispatchEvent(new Event('change', { bubbles: true }));
				editor.querySelector('.lumina-watch-editor__footer button.mod-cta')?.click();
				await new Promise((r) => setTimeout(r, 250));

				// FolderWatchManager 시작 유예(8초)가 지날 때까지 대기
				const fwm = lumina.folderWatchManager;
				const elapsedSinceStart = Date.now() - (fwm?.startedAt || 0);
				if (elapsedSinceStart < 8200) {
					await new Promise((r) => setTimeout(r, 8200 - elapsedSinceStart));
				}

				// 6-A. 수동 스캔 버튼 없이 실제 vault.create 이벤트로 Auto-Stage 트리거 검증
				await app.vault.create(
					'__lumina_e2e_watch_src__/LiveCreatedStage.md',
					'Live vault create event document for Auto-Watch auto-stage E2E test with enough body content.',
				);
				let eventAutoStaged = false;
				const stDead = Date.now() + 9000;
				while (Date.now() < stDead) {
					const wp = getWatchPane();
					const stagedCards = wp?.querySelectorAll('.lumina-watch-col')[1]?.querySelectorAll('.lumina-watch-card') || [];
					if (Array.from(stagedCards).some((c) => (c.textContent || '').includes('LiveCreatedStage'))) {
						eventAutoStaged = true;
						break;
					}
					await new Promise((r) => setTimeout(r, 200));
				}
				const deferredInSource = !!app.vault.getAbstractFileByPath('__lumina_e2e_watch_src__/LiveCreatedStage.md');

				// 수락 -> 이동 & 프론트매터 반영 -> Watch 히스토리 롤백
				const stagedCol = getWatchPane()?.querySelectorAll('.lumina-watch-col')[1];
				stagedCol?.querySelector('.lumina-watch-card button.mod-cta')?.click();
				let approvedMoved = false;
				const apDead = Date.now() + 4000;
				while (Date.now() < apDead) {
					if (
						app.vault.getAbstractFileByPath('__lumina_e2e_watch_dest__/LiveCreatedStage.md') &&
						!app.vault.getAbstractFileByPath('__lumina_e2e_watch_src__/LiveCreatedStage.md')
					) {
						approvedMoved = true;
						break;
					}
					await new Promise((r) => setTimeout(r, 100));
				}

				// 히스토리 롤백 검증
				studio.querySelector('.lumina-batch-main-tab[data-tab="history"]')?.click();
				await new Promise((r) => setTimeout(r, 200));
				const watchHistCard = studio.querySelector('.lumina-batch-history-card');
				const hasWatchBadge = (watchHistCard?.textContent || '').includes('E2E AutoWatch Rule');
				watchHistCard?.querySelector('button.lumina-batch-btn')?.click();
				await new Promise((r) => setTimeout(r, 100));
				watchHistCard?.querySelector('.lumina-batch-confirm-inline button.mod-warning')?.click();
				await new Promise((r) => setTimeout(r, 350));
				const watchRolledBack = !!app.vault.getAbstractFileByPath('__lumina_e2e_watch_src__/LiveCreatedStage.md');

				// 6-B. 규칙 편집 -> auto-apply 전환 -> 실제 vault.create 즉시 이동 확인
				studio.querySelector('.lumina-batch-main-tab[data-tab="watch"]')?.click();
				await new Promise((r) => setTimeout(r, 250));
				const ruleCard = Array.from(getWatchPane()?.querySelectorAll('.lumina-watch-col')[0]?.querySelectorAll('.lumina-watch-card') || [])
					.find((c) => (c.textContent || '').includes('E2E AutoWatch Rule'));
				ruleCard?.querySelectorAll('.lumina-watch-card__actions button')[1]?.click(); // Edit
				await new Promise((r) => setTimeout(r, 200));
				const editForm = getWatchPane()?.querySelector('.lumina-watch-editor');
				if (!editForm) return { success: false, reason: 'Watch edit form missing after switching back' };
				selSetter.call(editForm.querySelector('#lumina-watch-exec'), 'auto-apply');
				editForm.querySelector('#lumina-watch-exec').dispatchEvent(new Event('change', { bubbles: true }));
				editForm.querySelector('.lumina-watch-editor__footer button.mod-cta')?.click();
				await new Promise((r) => setTimeout(r, 250));

				await app.vault.create(
					'__lumina_e2e_watch_src__/LiveAutoApply.md',
					'Live vault create event document for Auto-Watch auto-apply E2E test with enough body content.',
				);
				let autoAppliedMoved = false;
				const aaDead = Date.now() + 9000;
				while (Date.now() < aaDead) {
					if (
						app.vault.getAbstractFileByPath('__lumina_e2e_watch_dest__/LiveAutoApply.md') &&
						!app.vault.getAbstractFileByPath('__lumina_e2e_watch_src__/LiveAutoApply.md')
					) {
						autoAppliedMoved = true;
						break;
					}
					await new Promise((r) => setTimeout(r, 200));
				}

				// 6-C. 규칙 삭제
				const ruleCardAfter = Array.from(getWatchPane()?.querySelectorAll('.lumina-watch-col')[0]?.querySelectorAll('.lumina-watch-card') || [])
					.find((c) => (c.textContent || '').includes('E2E AutoWatch Rule'));
				ruleCardAfter?.querySelectorAll('.lumina-watch-card__actions button')[2]?.click(); // Delete
				await new Promise((r) => setTimeout(r, 200));
				const ruleDeleted = !Array.from(getWatchPane()?.querySelectorAll('.lumina-watch-col')[0]?.querySelectorAll('.lumina-watch-card') || [])
					.some((c) => (c.textContent || '').includes('E2E AutoWatch Rule'));

				return {
					success: eventAutoStaged && deferredInSource && approvedMoved && hasWatchBadge && watchRolledBack && autoAppliedMoved && ruleDeleted,
					eventAutoStaged,
					deferredInSource,
					approvedMoved,
					watchRolledBack,
					autoAppliedMoved,
					ruleDeleted,
				};
			})()`);

			reporter.record(
				'Auto-Watch Live Vault Event (Auto-Stage, Approve, History Rollback, Edit -> Auto-Apply & Delete)',
				watchRes.success,
				`EventAutoStage=${watchRes.eventAutoStaged}(deferred=${watchRes.deferredInSource}), Approved=${watchRes.approvedMoved}, Rollback=${watchRes.watchRolledBack}, AutoApply=${watchRes.autoAppliedMoved}, RuleDeleted=${watchRes.ruleDeleted}`,
				Date.now() - tWatch,
			);

			// 7. Orphan Notes Pro 기능 전체 (진입점, AI 문맥 링크, MOC 생성, 일괄 아카이브/휴지통 + 내용 복원 롤백)
			const tOrphan = Date.now();
			const orphanRes = await client.evaluate(`(async () => {
				const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
				const folder = '__lumina_e2e_orphan_test__';
				for (const p of [folder, '__lumina_e2e_orphan_archive__']) {
					const ex = app.vault.getAbstractFileByPath(p);
					if (ex) await app.vault.delete(ex, true);
				}
				await app.vault.createFolder(folder);
				await app.vault.createFolder('__lumina_e2e_orphan_archive__');
				// 허브 노트와 공통 키워드(QuantumBananaProtocol)를 공유하는 고아노트 3개
				await app.vault.create(folder + '/HubAnchor.md', '# Hub Anchor\\nReferences [[HubTarget]] and discusses QuantumBananaProtocol architecture.');
				await app.vault.create(folder + '/HubTarget.md', '# Hub Target\\nLinked from HubAnchor.');
				await app.vault.create(folder + '/OrphanOne.md', 'OrphanOne discusses QuantumBananaProtocol in depth for E2E recommendation.');
				await app.vault.create(folder + '/OrphanTwo.md', 'OrphanTwo also covers QuantumBananaProtocol for MOC and bulk action.');
				await app.vault.create(folder + '/OrphanThree.md', 'OrphanThree covers QuantumBananaProtocol for AI contextual linking.');
				await new Promise((r) => setTimeout(r, 500));

				// lumina:open-orphan-notes 커맨드로 바로 Orphan 탭 오픈 확인
				app.workspace.getLeavesOfType('lumina-batch-studio').forEach((l) => l.detach());
				await new Promise((r) => setTimeout(r, 200));
				app.commands.executeCommandById('lumina:open-orphan-notes');
				const oDead = Date.now() + 4000;
				while (Date.now() < oDead) {
					if (document.querySelector('.lumina-orphan-tab')) break;
					await new Promise((r) => setTimeout(r, 100));
				}

				const studio = document.querySelector('div.lumina-batch-studio');
				const orphanTab = studio?.querySelector('.lumina-orphan-tab');
				if (!orphanTab) return { success: false, reason: 'Orphan tab failed to open via command' };

				// 유예 기간 0일 + 폴더 필터 지정
				const graceIn = orphanTab.querySelector('.lumina-orphan-num-input');
				if (graceIn) {
					setter.call(graceIn, '0');
					graceIn.dispatchEvent(new Event('change', { bubbles: true }));
				}
				const folderFilterIn = orphanTab.querySelector('input[list="lumina-orphan-folder-list"]');
				if (folderFilterIn) {
					setter.call(folderFilterIn, folder);
					folderFilterIn.dispatchEvent(new Event('input', { bubbles: true }));
				}
				await new Promise((r) => setTimeout(r, 500));

				// 7-A. OrphanThree 선택 -> 추천 카드의 Pro AI 문맥 링크 생성 & 적용
				const threeBtn = Array.from(orphanTab.querySelectorAll('.lumina-orphan-item__body')).find(
					(b) => (b.textContent || '').includes('OrphanThree'),
				);
				threeBtn?.click();
				let aiAppliedOk = false;
				const recDead = Date.now() + 4000;
				while (Date.now() < recDead) {
					if (orphanTab.querySelectorAll('.lumina-orphan-rec-card').length > 0) break;
					await new Promise((r) => setTimeout(r, 100));
				}
				const aiBtn = orphanTab.querySelectorAll('.lumina-orphan-rec-card__actions button')[1];
				aiBtn?.click();
				const diffDead = Date.now() + 5000;
				while (Date.now() < diffDead) {
					if (orphanTab.querySelector('.lumina-orphan-diff-card')) break;
					await new Promise((r) => setTimeout(r, 100));
				}
				orphanTab.querySelector('.lumina-orphan-diff-card button.mod-cta')?.click();
				await new Promise((r) => setTimeout(r, 400));
				const threeContent = await app.vault.read(app.vault.getAbstractFileByPath(folder + '/OrphanThree.md'));
				aiAppliedOk = threeContent.includes('[[');

				// 7-B. OrphanOne, OrphanTwo 체크 -> Pro MOC 생성
				for (const name of ['OrphanOne', 'OrphanTwo']) {
					const cb = orphanTab.querySelector('.lumina-orphan-item input[aria-label="' + name + '"]');
					if (cb && !cb.checked) cb.click();
				}
				await new Promise((r) => setTimeout(r, 150));
				orphanTab.querySelectorAll('.lumina-orphan-bulk-actions button')[2]?.click(); // MOC
				await new Promise((r) => setTimeout(r, 150));
				const mocInputs = orphanTab.querySelectorAll('.lumina-orphan-moc-form input');
				if (mocInputs[0]) {
					setter.call(mocInputs[0], folder + '/OrphanMOC.md');
					mocInputs[0].dispatchEvent(new Event('input', { bubbles: true }));
				}
				orphanTab.querySelector('.lumina-orphan-moc-form button.mod-cta')?.click();
				await new Promise((r) => setTimeout(r, 450));
				const mocFile = app.vault.getAbstractFileByPath(folder + '/OrphanMOC.md');
				const mocContent = mocFile ? await app.vault.read(mocFile) : '';
				const mocCreatedOk = mocContent.includes('OrphanOne') && mocContent.includes('OrphanTwo');
				if (mocFile) await app.vault.delete(mocFile, true);
				await new Promise((r) => setTimeout(r, 350));

				// 7-C. OrphanOne, OrphanTwo 체크 -> Pro Bulk Archive -> 롤백
				for (const name of ['OrphanOne', 'OrphanTwo']) {
					const cb = orphanTab.querySelector('.lumina-orphan-item input[aria-label="' + name + '"]');
					if (cb && !cb.checked) cb.click();
				}
				const archIn = orphanTab.querySelector('.lumina-orphan-archive-group input');
				if (archIn) {
					setter.call(archIn, '__lumina_e2e_orphan_archive__');
					archIn.dispatchEvent(new Event('change', { bubbles: true }));
				}
				await new Promise((r) => setTimeout(r, 150));
				orphanTab.querySelectorAll('.lumina-orphan-bulk-actions button')[1]?.click(); // Bulk Archive
				await new Promise((r) => setTimeout(r, 450));
				const bulkArchivedOk =
					!!app.vault.getAbstractFileByPath('__lumina_e2e_orphan_archive__/OrphanOne.md') &&
					!!app.vault.getAbstractFileByPath('__lumina_e2e_orphan_archive__/OrphanTwo.md');

				// 히스토리 롤백 후 재스캔 대기
				studio.querySelector('.lumina-batch-main-tab[data-tab="history"]')?.click();
				await new Promise((r) => setTimeout(r, 150));
				const hCard = studio.querySelector('.lumina-batch-history-card');
				hCard?.querySelector('button.lumina-batch-btn')?.click();
				await new Promise((r) => setTimeout(r, 100));
				hCard?.querySelector('.lumina-batch-confirm-inline button.mod-warning')?.click();
				await new Promise((r) => setTimeout(r, 400));

				// 7-D. Pro Bulk Trash -> 히스토리 내용 복원 롤백
				studio.querySelector('.lumina-batch-main-tab[data-tab="orphans"]')?.click();
				await new Promise((r) => setTimeout(r, 400));
				for (const name of ['OrphanOne', 'OrphanTwo']) {
					const cb = studio.querySelector('.lumina-orphan-item input[aria-label="' + name + '"]');
					if (cb && !cb.checked) cb.click();
				}
				await new Promise((r) => setTimeout(r, 100));
				studio.querySelector('.lumina-orphan-bulk-actions button.is-danger')?.click();
				await new Promise((r) => setTimeout(r, 120));
				studio.querySelector('.lumina-orphan-confirm-row button.mod-warning')?.click();
				await new Promise((r) => setTimeout(r, 450));
				const bulkTrashedOk =
					!app.vault.getAbstractFileByPath(folder + '/OrphanOne.md') &&
					!app.vault.getAbstractFileByPath(folder + '/OrphanTwo.md');

				studio.querySelector('.lumina-batch-main-tab[data-tab="history"]')?.click();
				await new Promise((r) => setTimeout(r, 150));
				const tCard = studio.querySelector('.lumina-batch-history-card');
				tCard?.querySelector('button.lumina-batch-btn')?.click();
				await new Promise((r) => setTimeout(r, 100));
				tCard?.querySelector('.lumina-batch-confirm-inline button.mod-warning')?.click();
				await new Promise((r) => setTimeout(r, 400));
				const restoredFile = app.vault.getAbstractFileByPath(folder + '/OrphanOne.md');
				const restoredBody = restoredFile ? await app.vault.read(restoredFile) : '';
				const bulkTrashRolledBackOk = restoredBody.includes('QuantumBananaProtocol');

				return {
					success: aiAppliedOk && mocCreatedOk && bulkArchivedOk && bulkTrashedOk && bulkTrashRolledBackOk,
					aiAppliedOk,
					mocCreatedOk,
					bulkArchivedOk,
					bulkTrashedOk,
					bulkTrashRolledBackOk,
				};
			})()`);

			reporter.record(
				'Orphan Notes Pro (AI Contextual Link, MOC Create, Bulk Archive, Bulk Trash & Rollback)',
				orphanRes.success,
				`AiLink=${orphanRes.aiAppliedOk}, MOC=${orphanRes.mocCreatedOk}, BulkArchive=${orphanRes.bulkArchivedOk}, BulkTrash=${orphanRes.bulkTrashedOk}, Rollback=${orphanRes.bulkTrashRolledBackOk}`,
				Date.now() - tOrphan,
			);
		} catch (err) {
			reporter.record('Batch Studio, Auto-Watch & Orphan Notes (Pro)', false, err.message, 0);
		} finally {
			await cleanupProArtifacts(client);
		}
	});
}

/**
 * SUITE 14: Voice-to-Note (Pro Active) 전체 파이프라인 E2E 스위트.
 */
export async function runVoiceToNoteProSuite(client, input, reporter, mockServer) {
	reporter.startSuite('Voice-to-Note (Pro)');

	await withMockProvider(
		client,
		mockServer,
		async () => {
			try {
				// 1. 매니저, 3개 커맨드, 리본 및 설정 UI 토글 반응성 확인
				const tMeta = Date.now();
				const ready = await client.evaluate(`(() => {
					const lumina = app.plugins.plugins['lumina'];
					const cmds = Object.keys(app.commands.commands);
					return {
						hasManager: !!lumina?.voiceNoteManager,
						hasToggle: cmds.includes('lumina:toggle-voice-note-recording'),
						hasUpload: cmds.includes('lumina:transcribe-audio-file'),
						hasProcessPending: cmds.includes('lumina:process-pending-voice-notes'),
						hasRibbon: !!lumina?.voiceRibbonEl,
					};
				})()`);

				await client.evaluate(`(async () => {
					app.setting.open();
					app.setting.openTabById('lumina');
					const deadline = Date.now() + 3000;
					while (Date.now() < deadline) {
						if (document.querySelector('.lumina-settings__nav-btn')) break;
						await new Promise((r) => setTimeout(r, 100));
					}
				})()`);
				await sleep(200);

				const settingsToggleOk = await client.evaluate(`(async () => {
					const lumina = app.plugins.plugins['lumina'];
					const container = app.setting.activeTab?.containerEl;
					const navBtns = Array.from(container?.querySelectorAll('.lumina-settings__nav-btn:not(.lumina-settings__nav-btn--advanced)') || []);
					navBtns[navBtns.length - 1]?.click();
					await new Promise((r) => setTimeout(r, 200));
					const hasHeading = (container?.textContent || '').includes('AI Voice-to-Note');
					// Voice 리본 토글(첫 번째 voice 설정 행) OFF -> ON 반응형 확인
					const items = Array.from(container?.querySelectorAll('.setting-item') || []);
					const voiceToggleItem = items.find((el) => (el.textContent || '').includes('Voice-to-Note') && el.querySelector('.checkbox-container'));
					const toggleEl = voiceToggleItem?.querySelector('.checkbox-container');
					let offOk = false;
					let onOk = false;
					if (toggleEl) {
						toggleEl.click();
						await new Promise((r) => setTimeout(r, 150));
						offOk = !lumina?.voiceRibbonEl;
						toggleEl.click();
						await new Promise((r) => setTimeout(r, 150));
						onOk = !!lumina?.voiceRibbonEl;
					}
					return { hasHeading, offOk, onOk };
				})()`);
				await input.pressEscape();
				await sleep(200);

				reporter.record(
					'Voice-to-Note Manager, 3 Commands, Ribbon Toggle & Settings Section',
					ready.hasManager &&
						ready.hasToggle &&
						ready.hasUpload &&
						ready.hasProcessPending &&
						ready.hasRibbon &&
						settingsToggleOk.hasHeading &&
						settingsToggleOk.offOk &&
						settingsToggleOk.onOk,
					`Cmds=${ready.hasToggle}/${ready.hasUpload}/${ready.hasProcessPending}, RibbonToggle=${settingsToggleOk.offOk}->${settingsToggleOk.onOk}`,
					Date.now() - tMeta,
				);

				// 2. 전체 녹음 -> Stop & Process -> STT+LLM -> 볼트 오디오 저장 + 위키링크 + 메모 병합 + 검토 바 재정리/원본/Undo
				const tFull = Date.now();
				mockServer.clearRequests();
				const partA = await client.evaluate(`(async () => {
					const lumina = app.plugins.plugins['lumina'];
					await app.vault.create('VoiceTargetLink.md', '# Voice Target Link\\nTarget note for auto wikilink.');
					const testFile = await app.vault.create('__lumina_e2e_voice_test__.md', '# Voice E2E Test\\nInitial line.');
					const leaf = app.workspace.getLeaf(false);
					await leaf.openFile(testFile);
					app.workspace.setActiveLeaf(leaf, { focus: true });
					await new Promise((r) => setTimeout(r, 350));

					const hasViewAction = !!leaf.view?.containerEl?.querySelector('.lumina-voice-view-action');

					const origMediaDevices = navigator.mediaDevices;
					const origGetUserMedia = origMediaDevices?.getUserMedia?.bind(origMediaDevices);
					const AudioCtx = window.AudioContext || window.webkitAudioContext;
					const audioCtx = new AudioCtx();
					await audioCtx.resume().catch(() => {});
					const dest = audioCtx.createMediaStreamDestination();
					const osc = audioCtx.createOscillator();
					osc.connect(dest);
					osc.start();
					if (!navigator.mediaDevices) {
						Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: async () => dest.stream } });
					} else {
						navigator.mediaDevices.getUserMedia = async () => dest.stream;
					}

					try {
						leaf.view?.containerEl?.querySelector('.lumina-voice-view-action')?.click();
						const pDead = Date.now() + 4000;
						while (Date.now() < pDead) {
							if (document.querySelector('.lumina-voice-controls .lumina-voice-btn--primary')) break;
							await new Promise((r) => setTimeout(r, 80));
						}

						const wrap = document.querySelector('.lumina-voice-pill-wrap');
						const controls = wrap?.querySelector('.lumina-voice-controls');
						// 자막 토글, 일시정지 -> 재개
						controls?.querySelector('button.lumina-voice-btn:not(.lumina-voice-btn--icon):not(.lumina-voice-btn--primary)')?.click();
						await new Promise((r) => setTimeout(r, 120));
						const captionsShown = !!wrap?.querySelector('.lumina-voice-captions');

						controls?.querySelectorAll('button.lumina-voice-btn--icon')[0]?.click();
						await new Promise((r) => setTimeout(r, 150));
						const pausedOk = !!wrap?.querySelector('.lumina-voice-dot.is-paused');
						controls?.querySelectorAll('button.lumina-voice-btn--icon')[0]?.click();
						await new Promise((r) => setTimeout(r, 150));

						// 녹음 중 라이브 사용자 메모 입력 (Granola형 병합 검증용)
						const editor = leaf.view?.editor;
						if (editor) {
							const cur = editor.getValue();
							editor.setValue(cur + '\\nLive user memo during recording');
						}

						// MediaRecorder timeslice(2000ms) 청크 생성 보장 대기
						const cDead = Date.now() + 3500;
						await new Promise((r) => setTimeout(r, 2200));
						while (Date.now() < cDead) {
							if ((lumina?.voiceNoteManager?.recorder?.recordedChunks?.length || 0) > 0) break;
							await new Promise((r) => setTimeout(r, 100));
						}
						// Stop & Process 클릭!
						controls?.querySelector('button.lumina-voice-btn--primary')?.click();

						let reviewMounted = false;
						const rDead = Date.now() + 15000;
						while (Date.now() < rDead) {
							if (document.querySelector('.lumina-voice-review-bar')) {
								reviewMounted = true;
								break;
							}
							await new Promise((r) => setTimeout(r, 120));
						}

						// 에디터 인메모리 버퍼 우선 읽기 (autosave 2초 지연 회피)
						const currentNote = leaf.view?.editor ? leaf.view.editor.getValue() : await app.vault.read(testFile);
						const audioFolder = app.vault.getAbstractFileByPath('__lumina_e2e_voice_audio__');
						const audioSaved = Boolean(audioFolder?.children && audioFolder.children.length > 0);
						const hasEmbedAndLink = currentNote.includes('![[__lumina_e2e_voice_audio__/') &&
							currentNote.includes('[[VoiceTargetLink]]') &&
							currentNote.includes('#lumina-ts=');

						return { hasViewAction, captionsShown, pausedOk, reviewMounted, audioSaved, hasEmbedAndLink };
					} finally {
						try { osc.stop(); } catch {}
						try { await audioCtx.close(); } catch {}
						if (origMediaDevices && origGetUserMedia) origMediaDevices.getUserMedia = origGetUserMedia;
					}
				})()`);

				const sttCountBeforeReprocess = mockServer.getSttRequests().length;
				const partB = await client.evaluate(`(async () => {
					const lumina = app.plugins.plugins['lumina'];
					const testFile = app.vault.getAbstractFileByPath('__lumina_e2e_voice_test__.md');
					const mdLeaves = app.workspace.getLeavesOfType('markdown');
					const leaf = mdLeaves.find((l) => l.view?.file?.path === '__lumina_e2e_voice_test__.md') || null;
					const readNote = async () => (leaf?.view?.editor ? leaf.view.editor.getValue() : testFile ? await app.vault.read(testFile) : '');

					try {
						// 검토 바: Meeting 템플릿 재정리 -> 원본만 남기기 -> Undo
						const sel = document.querySelector('.lumina-voice-rselect');
						if (sel) {
							const sSet = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
							sSet.call(sel, 'meeting');
							sel.dispatchEvent(new Event('change', { bubbles: true }));
						}
						let reprocessedMeeting = false;
						const mDead = Date.now() + 6000;
						while (Date.now() < mDead) {
							const txt = await readNote();
							if (txt.includes('## Meeting Minutes')) {
								reprocessedMeeting = true;
								break;
							}
							await new Promise((r) => setTimeout(r, 120));
						}

						// 원본만 남기기
						const rBtns = Array.from(document.querySelectorAll('.lumina-voice-review-bar button.lumina-voice-rbtn'));
						const rawOnlyBtn = rBtns.find((b) => !b.classList.contains('lumina-voice-rbtn--primary') && !b.classList.contains('lumina-voice-rbtn--danger'));
						rawOnlyBtn?.click();
						let rawReplacedOk = false;
						const rawDead = Date.now() + 4000;
						while (Date.now() < rawDead) {
							const txt = await readNote();
							if (!txt.includes('## Meeting Minutes') && txt.includes('![[__lumina_e2e_voice_audio__/')) {
								rawReplacedOk = true;
								break;
							}
							await new Promise((r) => setTimeout(r, 100));
						}

						// Undo -> 삽입된 블록 제거 & 검토 바 닫힘
						document.querySelector('.lumina-voice-rbtn--danger')?.click();
						let undoOk = false;
						const uDead = Date.now() + 4000;
						while (Date.now() < uDead) {
							const afterUndo = await readNote();
							if (!afterUndo.includes('![[__lumina_e2e_voice_audio__/') && !document.querySelector('.lumina-voice-review-bar')) {
								undoOk = true;
								break;
							}
							await new Promise((r) => setTimeout(r, 100));
						}

						return { reprocessedMeeting, rawReplacedOk, undoOk };
					} finally {
						lumina?.voiceNoteManager?.cancelRecording?.();
						leaf?.detach?.();
					}
				})()`);

				const sttReqs = mockServer.getSttRequests();
				const chatReqs = mockServer.getChatRequests();
				const vocabSent = sttReqs.some((r) => r.prompt.includes('LuminaCustomTerm'));
				const userMemoSent = chatReqs.some((r) =>
					r.messages.some((m) => String(m.content || '').includes('Live user memo during recording')),
				);
				// reprocessWithTemplate는 오디오를 재전송하지 않아야 함
				const sttNoReupload = sttCountBeforeReprocess >= 1 && sttReqs.length === sttCountBeforeReprocess;

				reporter.record(
					'Voice-to-Note Full Pipeline (Record, Stop&Process, STT+Vocab, UserMemo, AutoLink, Review Reprocess & Undo)',
					partA.hasViewAction &&
						partA.captionsShown &&
						partA.pausedOk &&
						partA.reviewMounted &&
						partA.audioSaved &&
						partA.hasEmbedAndLink &&
						partB.reprocessedMeeting &&
						partB.rawReplacedOk &&
						partB.undoOk &&
						vocabSent &&
						userMemoSent &&
						sttNoReupload,
					`Review=${partA.reviewMounted}, AudioSaved=${partA.audioSaved}, WikiLink+TS=${partA.hasEmbedAndLink}, Reprocess=${partB.reprocessedMeeting}, RawOnly=${partB.rawReplacedOk}, Undo=${partB.undoOk}, Vocab=${vocabSent}, Memo=${userMemoSent}, SttCalls=${sttCountBeforeReprocess}->${sttReqs.length}`,
					Date.now() - tFull,
				);

				// 3. 빈 워크스페이스 새 노트 자동 생성 + file-menu 오디오 파일 변환 + 실제 Reading 모드 타임스탬프 싱크 재생
				const tVaultAudio = Date.now();
				mockServer.clearRequests();
				const vaultAudioRes = await client.evaluate(`(async () => {
					const lumina = app.plugins.plugins['lumina'];
					// 합성 3초 WAV 생성
					const sr = 8000;
					const samples = sr * 3;
					const buf = new ArrayBuffer(44 + samples);
					const dv = new DataView(buf);
					const w = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
					w(0, 'RIFF'); dv.setUint32(4, 36 + samples, true); w(8, 'WAVE');
					w(12, 'fmt '); dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
					dv.setUint32(24, sr, true); dv.setUint32(28, sr, true); dv.setUint16(32, 1, true); dv.setUint16(34, 8, true);
					w(36, 'data'); dv.setUint32(40, samples, true);

					const folder = '__lumina_e2e_voice_audio__';
					if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
					const wavFile = await app.vault.createBinary(folder + '/e2e_sample.wav', buf);

					// file-menu에 Voice 변환 메뉴 노출 확인
					const menuTitles = [];
					app.workspace.trigger('file-menu', {
						addItem(cb) {
							const it = { title: '', setTitle(t){ this.title = t; return this; }, setIcon(){ return this; }, setSection(){ return this; }, onClick(){ return this; } };
							cb(it); menuTitles.push(it.title); return this;
						},
						addSeparator() { return this; },
					}, wavFile);
					const hasAudioFileMenu = menuTitles.some((t) => t.includes('Lumina'));

					// 모든 마크다운 탭 닫고 transcribeVaultFile 호출 -> 새 노트 자동 생성 확인
					app.workspace.getLeavesOfType('markdown').forEach((l) => l.detach());
					await new Promise((r) => setTimeout(r, 150));
					await lumina.voiceNoteManager.transcribeVaultFile(wavFile);
					let createdNotePath = null;
					const cDead = Date.now() + 6000;
					while (Date.now() < cDead) {
						const mdLeaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view?.file?.name?.startsWith('Voice Note '));
						if (mdLeaf && document.querySelector('.lumina-voice-review-bar')) {
							createdNotePath = mdLeaf.view.file.path;
							break;
						}
						await new Promise((r) => setTimeout(r, 100));
					}

					// 생성된 새 노트 Undo로 정리
					if (document.querySelector('.lumina-voice-rbtn--danger')) {
						document.querySelector('.lumina-voice-rbtn--danger')?.click();
						await new Promise((r) => setTimeout(r, 300));
					}

					// 실제 마크다운 Reading 모드에서 Obsidian 렌더링 오디오 + #lumina-ts=2 링크 시킹 검증
					const tsNote = await app.vault.create(
						'__lumina_e2e_voice_reading__.md',
						'![[' + folder + '/e2e_sample.wav]]\\n\\n> [!note]- Raw\\n> - **[00:02](#lumina-ts=2)** jump test\\n',
					);
					const rLeaf = app.workspace.getLeaf(false);
					await rLeaf.setViewState({ type: 'markdown', state: { file: tsNote.path, mode: 'preview' }, active: true });
					let audioEl = null;
					let tsLinkEl = null;
					const rdDead = Date.now() + 4000;
					while (Date.now() < rdDead) {
						const vc = rLeaf.view?.containerEl?.querySelector('.view-content');
						audioEl = vc?.querySelector('audio');
						tsLinkEl = vc?.querySelector('a[href="#lumina-ts=2"]');
						if (audioEl && tsLinkEl && audioEl.readyState >= 1) break;
						await new Promise((r) => setTimeout(r, 100));
					}
					let realTimestampSeekOk = false;
					if (audioEl && tsLinkEl) {
						let playAttempted = false;
						const origPlay = audioEl.play?.bind(audioEl);
						audioEl.play = () => {
							playAttempted = true;
							return origPlay ? origPlay().catch(() => {}) : Promise.resolve();
						};
						tsLinkEl.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
						await new Promise((r) => setTimeout(r, 120));
						realTimestampSeekOk = playAttempted && Math.round(audioEl.currentTime) === 2;
						try { audioEl.pause?.(); } catch {}
					}
					rLeaf.detach();
					await app.vault.delete(tsNote, true);

					return {
						hasAudioFileMenu,
						createdNewNoteOk: Boolean(createdNotePath),
						realTimestampSeekOk,
					};
				})()`);

				reporter.record(
					'Voice-to-Note New Note on Empty Workspace, File-Menu & Real Markdown Timestamp Seek',
					vaultAudioRes.hasAudioFileMenu && vaultAudioRes.createdNewNoteOk && vaultAudioRes.realTimestampSeekOk,
					`AudioFileMenu=${vaultAudioRes.hasAudioFileMenu}, NewNoteCreated=${vaultAudioRes.createdNewNoteOk}, RealReadingSeek2s=${vaultAudioRes.realTimestampSeekOk}`,
					Date.now() - tVaultAudio,
				);

				// 4. 크래시 복구 배너(IndexedDB), 마이크 권한 거부 에러 배너 & PendingVoiceScanner -> process-pending-voice-notes 제자리 교체
				const tResilience = Date.now();
				const resCheck = await client.evaluate(`(async () => {
					const lumina = app.plugins.plugins['lumina'];

					// 4-A. IndexedDB 백업 시드 -> 복구 배너 노출 -> 폐기
					await new Promise((resolve) => {
						const req = indexedDB.open('lumina-voice-recovery-v1', 1);
						req.onupgradeneeded = () => {
							if (!req.result.objectStoreNames.contains('sessions')) {
								req.result.createObjectStore('sessions', { keyPath: 'id' });
							}
						};
						req.onsuccess = () => {
							const db = req.result;
							const tx = db.transaction('sessions', 'readwrite');
							tx.objectStore('sessions').put({
								id: 'active',
								chunkBuffers: [new Uint8Array([1, 2, 3, 4]).buffer],
								mimeType: 'audio/wav',
								elapsedSec: 5,
								targetFilePath: null,
								templateId: 'clean',
								updatedAt: Date.now(),
							});
							tx.oncomplete = () => { db.close(); resolve(); };
						};
					});
					// init() 재호출 없이 새 매니저 리로드로 복구 배너 감지 검증
					await app.plugins.disablePlugin('lumina');
					await app.plugins.enablePlugin('lumina');
					await new Promise((r) => setTimeout(r, 600));
					const lumina2 = app.plugins.plugins['lumina'];
					const recoveryBannerShown = !!document.querySelector('.lumina-voice-pill--recovery');
					const recBtns = document.querySelectorAll('.lumina-voice-pill--recovery .lumina-voice-btn');
					recBtns[recBtns.length - 1]?.click(); // Discard
					let recoveryDismissed = false;
					const discDead = Date.now() + 2500;
					while (Date.now() < discDead) {
						if (!document.querySelector('.lumina-voice-pill--recovery')) {
							recoveryDismissed = true;
							break;
						}
						await new Promise((r) => setTimeout(r, 80));
					}

					// 4-B. 마이크 권한 거부 시 에러 배너 노출 & 닫기
					const origGUM = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
					if (navigator.mediaDevices) {
						navigator.mediaDevices.getUserMedia = async () => {
							const err = new Error('Permission denied');
							err.name = 'NotAllowedError';
							throw err;
						};
					}
					await lumina2.voiceNoteManager.startRecording();
					await new Promise((r) => setTimeout(r, 150));
					const errorBannerShown = !!document.querySelector('.lumina-voice-pill--error');
					document.querySelector('.lumina-voice-pill--error button')?.click();
					await new Promise((r) => setTimeout(r, 150));
					const errorDismissed = !document.querySelector('.lumina-voice-pill--error');
					if (navigator.mediaDevices && origGUM) navigator.mediaDevices.getUserMedia = origGUM;

					// 4-C. PendingVoiceScanner & lumina:process-pending-voice-notes 제자리 교체
					const folder = '__lumina_e2e_voice_audio__';
					const audioPath = folder + '/e2e_sample.wav';
					const markerBlock = [
						'<!-- lumina-voice:pending id="e2e_p1" audio="' + audioPath + '" template="clean" -->',
						'![[' + audioPath + ']]',
						'> [!info] Pending desktop transcription',
						'<!-- /lumina-voice:pending -->',
					].join('\\n');
					const defNote = await app.vault.create(
						'__lumina_e2e_voice_deferred__.md',
						'# Deferred Voice Note\\n\\n' + markerBlock + '\\n\\nTrailing paragraph.',
					);

					// audio mtime이 3초(settleDelayMs) 이상 경과되도록 대기
					const wavObj = app.vault.getAbstractFileByPath(audioPath);
					const age = Date.now() - (wavObj?.stat?.mtime || 0);
					if (age < 3200) {
						await new Promise((r) => setTimeout(r, 3200 - age));
					}
					await lumina2.voiceNoteManager.pendingScanner?.refreshNow?.();
					await new Promise((r) => setTimeout(r, 200));
					const pendingBannerShown = !!document.querySelector('.lumina-voice-pill--recovery');

					app.commands.executeCommandById('lumina:process-pending-voice-notes');
					let pendingReplacedOk = false;
					const pDead = Date.now() + 8000;
					while (Date.now() < pDead) {
						const txt = await app.vault.read(defNote);
						if (!txt.includes('lumina-voice:pending') && txt.includes('## Key Points') && txt.includes('Trailing paragraph.')) {
							pendingReplacedOk = true;
							break;
						}
						await new Promise((r) => setTimeout(r, 120));
					}
					lumina2.voiceNoteManager?.applyReview?.();

					return {
						recoveryBannerShown,
						recoveryDismissed,
						errorBannerShown,
						errorDismissed,
						pendingBannerShown,
						pendingReplacedOk,
					};
				})()`);

				reporter.record(
					'Voice-to-Note Recovery Banner, Mic Denial Error Banner & Deferred Pending Scanner Replacement',
					resCheck.recoveryBannerShown &&
						resCheck.recoveryDismissed &&
						resCheck.errorBannerShown &&
						resCheck.errorDismissed &&
						resCheck.pendingBannerShown &&
						resCheck.pendingReplacedOk,
					`Recovery=${resCheck.recoveryBannerShown}->${resCheck.recoveryDismissed}, MicError=${resCheck.errorBannerShown}->${resCheck.errorDismissed}, PendingBanner=${resCheck.pendingBannerShown}, Replaced=${resCheck.pendingReplacedOk}`,
					Date.now() - tResilience,
				);
			} catch (err) {
				reporter.record('Voice-to-Note (Pro)', false, err.message, 0);
			} finally {
				await cleanupProArtifacts(client);
			}
		},
		{
			voiceNote: {
				sttMode: 'provider',
				sttProviderId: '__e2e_mock_prov__',
				llmProviderId: '__e2e_mock_prov__',
				llmModelId: 'mock-model-a',
				recordMode: 'post-process',
				audioStorageMode: 'vault',
				audioFolder: '__lumina_e2e_voice_audio__',
				defaultTemplate: 'clean',
				includeRawTranscript: true,
				autoWikiLink: true,
				customVocabulary: ['LuminaCustomTerm'],
				showRibbonIcon: true,
				mobileCaptureMode: 'auto',
			},
		},
	);
}

/**
 * SUITE 15-5: 모바일 에뮬레이션 환경(390x844) 내 Pro 기능 전체 E2E 검증.
 */
export async function runMobileProSuites(client, input, reporter, mockServer, options = {}) {
	const { mode } = await detectEntitlementMode(client);
	const { requiredMode = null } = options;

	if (requiredMode && mode !== requiredMode) {
		reporter.record(
			`Mobile Required Entitlement Mode (${requiredMode})`,
			false,
			`모바일 요구 모드=${requiredMode}, 실제 빌드 모드=${mode}`,
			0,
		);
		return;
	}

	if (mode === 'free-hidden') {
		reporter.recordSkip(
			'Mobile Pro Features (Split Chat, Voice-to-Note & Batch Studio)',
			'Skipped: Free-hidden build (Pro features hidden)',
		);
		return;
	}

	if (mode === 'freemium-preview') {
		const tMobFree = Date.now();
		const mobLock = await client.evaluate(`(async () => {
			app.workspace.getLeavesOfType('lumina-batch-studio').forEach((l) => l.detach());
			app.commands.executeCommandById('lumina:open-batch-studio');
			const deadline = Date.now() + 3500;
			while (Date.now() < deadline) {
				if (document.querySelector('div.lumina-batch-studio')) break;
				await new Promise((r) => setTimeout(r, 100));
			}
			const studio = document.querySelector('div.lumina-batch-studio');
			studio?.querySelector('.lumina-batch-main-tab[data-tab="watch"]')?.click();
			await new Promise((r) => setTimeout(r, 150));
			const hasWatchProCard = !!studio?.querySelector('.lumina-watch-pro-card');
			app.workspace.getLeavesOfType('lumina-batch-studio').forEach((l) => l.detach());
			return { hasWatchProCard };
		})()`);
		reporter.record(
			'Mobile Freemium Preview: Auto-Watch Locked Card Visible',
			mobLock.hasWatchProCard,
			`WatchProCard=${mobLock.hasWatchProCard}`,
			Date.now() - tMobFree,
		);
		return;
	}

	// Pro Active 모바일 테스트 (5-A Split Chat, 5-B Voice-to-Note, 5-C Batch Studio)
	await withMockProvider(
		client,
		mockServer,
		async () => {
			// 5-A. Mobile Split Chat (Pro): 컴팩트 탭 + 실제 프롬프트 스트리밍 + 탭 전환 + 백드롭 드로어 닫기
			const tMobSplit = Date.now();
			const mobSplitRes = await client.evaluate(`(async () => {
				app.workspace.getLeavesOfType('lumina-split-chat').forEach((l) => l.detach());
				app.commands.executeCommandById('lumina:open-split-chat');
				const deadline = Date.now() + 3500;
				while (Date.now() < deadline) {
					if (document.querySelector('.lumina-split-root')) break;
					await new Promise((r) => setTimeout(r, 100));
				}
				await new Promise((r) => setTimeout(r, 250));

				const root = document.querySelector('.lumina-split-root');
				const hasMobileSlotBar = !!root?.querySelector('.lumina-split-slotbar__mobile');
				const noDesktopGrid = !root?.querySelector('.lumina-split-slotbar__grid');
				const tabs = Array.from(root?.querySelectorAll('.lumina-split-slotbar__mobile-tab') || []);

				// 실제 프롬프트 전송 및 스트리밍 완료
				const ta = root?.querySelector('textarea');
				if (ta) {
					const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
					setter.call(ta, 'MOBILE_SPLIT_E2E');
					ta.dispatchEvent(new Event('input', { bubbles: true }));
				}
				await new Promise((r) => setTimeout(r, 80));
				root?.querySelector('.lumina-chat__send-btn')?.click();

				let streamedA = false;
				let streamedB = false;
				const sDead = Date.now() + 8000;
				while (Date.now() < sDead) {
					const cardText = root?.querySelector('.lumina-split-card__content')?.textContent || '';
					if (cardText.includes('[RESP:')) {
						streamedA = true;
						break;
					}
					await new Promise((r) => setTimeout(r, 100));
				}

				if (tabs.length >= 2) {
					tabs[1].click();
					const bDead = Date.now() + 5000;
					while (Date.now() < bDead) {
						const cardB = root?.querySelector('.lumina-split-card__content')?.textContent || '';
						if (cardB.includes('MOBILE_SPLIT_E2E')) {
							streamedB = true;
							break;
						}
						await new Promise((r) => setTimeout(r, 100));
					}
				}

				// 드로어 열기 및 백드롭 클릭 닫기
				root?.querySelector('.lumina-split-header__left .lumina-split-header__icon-btn')?.click();
				await new Promise((r) => setTimeout(r, 150));
				const backdrop = root?.querySelector('.lumina-split-root__drawer-backdrop');
				backdrop?.click();
				await new Promise((r) => setTimeout(r, 150));
				const drawerClosedByBackdrop = !root?.querySelector('.lumina-split-root__drawer-wrap');
				const noOverflow = root ? root.scrollWidth <= root.clientWidth + 4 : false;

				app.workspace.getLeavesOfType('lumina-split-chat').forEach((l) => l.detach());
				return {
					success: hasMobileSlotBar && noDesktopGrid && tabs.length >= 2 && streamedA && streamedB && drawerClosedByBackdrop && noOverflow,
					hasMobileSlotBar,
					tabCount: tabs.length,
					streamedA,
					streamedB,
					drawerClosedByBackdrop,
					noOverflow,
				};
			})()`);

			reporter.record(
				'Mobile Split Chat (Pro): Compact Tabs, Live Streaming, Tab Switch & Backdrop Drawer',
				mobSplitRes.success,
				`MobileBar=${mobSplitRes.hasMobileSlotBar}(tabs=${mobSplitRes.tabCount}), StreamA/B=${mobSplitRes.streamedA}/${mobSplitRes.streamedB}, BackdropClose=${mobSplitRes.drawerClosedByBackdrop}, OverflowOK=${mobSplitRes.noOverflow}`,
				Date.now() - tMobSplit,
			);

			// 5-B. Mobile Voice-to-Note (Pro): local-whisper 숨김 + 실제 지연 캡처 볼트 저장/마커 삽입 + 클라우드 STT 완료(.is-mobile)
			const tMobVoice = Date.now();
			const mobVoicePart1 = await client.evaluate(`(async () => {
				const lumina = app.plugins.plugins['lumina'];
				lumina.settings.voiceNote = {
					...(lumina.settings.voiceNote || {}),
					sttMode: 'auto',
					mobileCaptureMode: 'auto',
					audioFolder: '__lumina_e2e_voice_audio__',
				};
				await lumina.saveSettings();

				app.setting.open();
				app.setting.openTabById('lumina');
				const sDead = Date.now() + 3000;
				while (Date.now() < sDead) {
					if (document.querySelector('.lumina-settings__nav-btn')) break;
					await new Promise((r) => setTimeout(r, 100));
				}
				await new Promise((r) => setTimeout(r, 150));
				const container = app.setting.activeTab?.containerEl;
				const navBtns = Array.from(container?.querySelectorAll('.lumina-settings__nav-btn:not(.lumina-settings__nav-btn--advanced)') || []);
				navBtns[navBtns.length - 1]?.click();
				await new Promise((r) => setTimeout(r, 200));

				const selects = Array.from(container?.querySelectorAll('select') || []);
				const sttSel = selects.find((s) => Array.from(s.options).some((o) => o.value === 'provider'));
				const localWhisperExcluded = sttSel ? !Array.from(sttSel.options).some((o) => o.value === 'local-whisper') : false;
				const localModelHidden = !selects.some((s) => Array.from(s.options).some((o) => o.value.includes('Xenova/whisper')));
				app.setting.close();
				while (document.querySelector('.modal-container')) await new Promise((r) => setTimeout(r, 50));

				const origGUM = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
				const AudioCtx = window.AudioContext || window.webkitAudioContext;
				const audioCtx = new AudioCtx();
				await audioCtx.resume().catch(() => {});
				const dest = audioCtx.createMediaStreamDestination();
				const osc = audioCtx.createOscillator();
				osc.connect(dest);
				osc.start();
				if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => dest.stream;

				let deferredSavedMarker = false;
				let defDebug = {};
				try {
					const oldMob = app.vault.getAbstractFileByPath('__lumina_e2e_mobile_voice__.md');
					if (oldMob) await app.vault.delete(oldMob, true);
					const mobNote = await app.vault.create('__lumina_e2e_mobile_voice__.md', '# Mobile Voice Test\\n');
					let existingRootLeaf = app.workspace.getMostRecentLeaf(app.workspace.rootSplit);
					if (!existingRootLeaf) {
						app.workspace.iterateRootLeaves((l) => {
							if (!existingRootLeaf) existingRootLeaf = l;
						});
					}
					const leaf = existingRootLeaf
						? (app.workspace.setActiveLeaf(existingRootLeaf, { focus: true }), app.workspace.getLeaf('tab'))
						: app.workspace.createLeafInParent(app.workspace.rootSplit, 0);
					// 데스크탑 Obsidian MarkdownView 생성자의 mobileToolbar.isVisible NPE 방지를 위해 openFile 구간만 임시 해제
					const setMobFlag = (mob) => {
						const p = window.__luminaObsidianMod?.Platform;
						if (p) {
							Object.defineProperty(p, 'isMobile', { value: mob, configurable: true, writable: true });
							Object.defineProperty(p, 'isDesktop', { value: !mob, configurable: true, writable: true });
							Object.defineProperty(p, 'isDesktopApp', { value: !mob, configurable: true, writable: true });
							Object.defineProperty(p, 'isMobileApp', { value: mob, configurable: true, writable: true });
						}
						app.isMobile = mob;
					};
					setMobFlag(false);
					try {
						await leaf.openFile(mobNote, { state: { mode: 'source' } });
					} finally {
						setMobFlag(true);
					}
					app.workspace.setActiveLeaf(leaf, { focus: true });
					await new Promise((r) => setTimeout(r, 300));
					const readMobNote = async () => (leaf.view?.editor ? leaf.view.editor.getValue() : await app.vault.read(mobNote));

					// 1) 지연 캡처 실제 Stop & Save -> 볼트 오디오 + pending 마커 삽입 확인
					lumina.settings.voiceNote.mobileCaptureMode = 'defer-to-desktop';
					await lumina.saveSettings();
					app.commands.executeCommandById('lumina:toggle-voice-note-recording');
					const dDead = Date.now() + 3000;
					while (Date.now() < dDead) {
						if (document.querySelector('.lumina-voice-controls .lumina-voice-btn--primary')) break;
						await new Promise((r) => setTimeout(r, 80));
					}
					const cDead = Date.now() + 3800;
					await new Promise((r) => setTimeout(r, 2200));
					while (Date.now() < cDead) {
						if ((lumina?.voiceNoteManager?.recorder?.recordedChunks?.length || 0) > 0) break;
						await new Promise((r) => setTimeout(r, 100));
					}
					const chunksBefore = lumina?.voiceNoteManager?.recorder?.recordedChunks?.length || 0;
					const primaryText = document.querySelector('.lumina-voice-controls .lumina-voice-btn--primary')?.textContent?.trim() || '';
					const targetBeforeStop = lumina?.voiceNoteManager?.targetFile?.path ?? null;
					const activeAtStop = app.workspace.getActiveFile()?.path ?? null;
					document.querySelector('.lumina-voice-controls .lumina-voice-btn--primary')?.click();
					const saveDead = Date.now() + 8000;
					while (Date.now() < saveDead) {
						const content = await readMobNote();
						if (content.includes('<!-- lumina-voice:pending') && content.includes('![[__lumina_e2e_voice_audio__/')) {
							deferredSavedMarker = true;
							break;
						}
						await new Promise((r) => setTimeout(r, 100));
					}
					const vnFiles = app.vault.getMarkdownFiles().filter((f) => f.name.startsWith('Voice Note '));
					defDebug = {
						chunksBefore,
						primaryText,
						targetBeforeStop,
						activeAtStop,
						edSnippet: (await readMobNote()).slice(0, 60),
						voiceNotes: vnFiles.length,
						vnPath: vnFiles[0]?.path ?? null,
					};
					for (const vnf of vnFiles) {
						try { await app.vault.delete(vnf, true); } catch {}
					}
					const idleDead = Date.now() + 3000;
					while (Date.now() < idleDead) {
						if (!document.querySelector('.lumina-voice-pill')) break;
						await new Promise((r) => setTimeout(r, 80));
					}
				} finally {
					lumina?.voiceNoteManager?.cancelRecording?.();
					try { osc.stop(); } catch {}
					try { await audioCtx.close(); } catch {}
					if (navigator.mediaDevices && origGUM) navigator.mediaDevices.getUserMedia = origGUM;
				}
				return { localWhisperExcluded, localModelHidden, deferredSavedMarker, defDebug };
			})()`, 35000);

			const mobVoicePart2 = await client.evaluate(`(async () => {
				const lumina = app.plugins.plugins['lumina'];
				const origGUM = navigator.mediaDevices?.getUserMedia?.bind(navigator.mediaDevices);
				const AudioCtx = window.AudioContext || window.webkitAudioContext;
				const audioCtx = new AudioCtx();
				await audioCtx.resume().catch(() => {});
				const dest = audioCtx.createMediaStreamDestination();
				const osc = audioCtx.createOscillator();
				osc.connect(dest);
				osc.start();
				if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => dest.stream;

				let cloudMobileReviewOk = false;
				let pillBottomPx = -1;
				const mobNote = app.vault.getAbstractFileByPath('__lumina_e2e_mobile_voice__.md');
				const leaf = app.workspace.getLeavesOfType('markdown').find((l) => l.view?.file?.path === '__lumina_e2e_mobile_voice__.md') || null;
				try {
					if (mobNote && leaf) {
						app.workspace.setActiveLeaf(leaf, { focus: true });
					}
					// 2) 클라우드 STT 모드 -> .is-mobile 필 위치 + Stop&Process -> 모바일 검토 바 마운트 & Undo
					lumina.settings.voiceNote.mobileCaptureMode = 'auto';
					lumina.settings.voiceNote.sttMode = 'provider';
					lumina.settings.voiceNote.sttProviderId = '__e2e_mock_prov__';
					lumina.settings.voiceNote.recordMode = 'post-process';
					await lumina.saveSettings();

					app.commands.executeCommandById('lumina:toggle-voice-note-recording');
					const pDead = Date.now() + 3500;
					while (Date.now() < pDead) {
						const wrap = document.querySelector('.lumina-voice-pill-wrap.is-mobile');
						if (wrap && document.querySelector('.lumina-voice-controls .lumina-voice-btn--primary')) {
							pillBottomPx = parseFloat(getComputedStyle(wrap).bottom || '-1');
							break;
						}
						await new Promise((r) => setTimeout(r, 80));
					}
					await new Promise((r) => setTimeout(r, 2200));
					document.querySelector('.lumina-voice-controls .lumina-voice-btn--primary')?.click();
					const revDead = Date.now() + 10000;
					while (Date.now() < revDead) {
						if (document.querySelector('.lumina-voice-review-wrap.is-mobile')) {
							cloudMobileReviewOk = true;
							break;
						}
						await new Promise((r) => setTimeout(r, 120));
					}
					document.querySelector('.lumina-voice-rbtn--danger')?.click();
					await new Promise((r) => setTimeout(r, 300));
				} finally {
					lumina?.voiceNoteManager?.cancelRecording?.();
					try { osc.stop(); } catch {}
					try { await audioCtx.close(); } catch {}
					if (navigator.mediaDevices && origGUM) navigator.mediaDevices.getUserMedia = origGUM;
					leaf?.detach?.();
					if (mobNote) {
						try { await app.vault.delete(mobNote, true); } catch {}
					}
				}
				return { cloudMobileReviewOk, pillBottomPx };
			})()`, 35000);

			const mobVoiceRes = {
				...mobVoicePart1,
				...mobVoicePart2,
				success:
					mobVoicePart1.localWhisperExcluded &&
					mobVoicePart1.localModelHidden &&
					mobVoicePart1.deferredSavedMarker &&
					mobVoicePart2.cloudMobileReviewOk &&
					mobVoicePart2.pillBottomPx >= 60,
			};

			reporter.record(
				'Mobile Voice-to-Note (Pro): Deferred Save Marker, Cloud STT Review & .is-mobile Offset',
				mobVoiceRes.success,
				`WhisperHidden=${mobVoiceRes.localWhisperExcluded}/${mobVoiceRes.localModelHidden}, DeferredMarker=${mobVoiceRes.deferredSavedMarker}(${JSON.stringify(mobVoiceRes.defDebug || {})}), CloudReview=${mobVoiceRes.cloudMobileReviewOk}, Bottom=${mobVoiceRes.pillBottomPx}px`,
				Date.now() - tMobVoice,
			);

			// 5-C. Mobile Batch Studio (Pro): 실행, 실제 일괄 적용 디스크 검증, 워크벤치 높이 & 가로 오버플로 0
			const tMobBatch = Date.now();
			const mobBatchRes = await client.evaluate(`(async () => {
				const folder = '__lumina_mobile_batch_e2e__';
				try {
					app.workspace.leftSplit?.collapse?.();
					app.workspace.rightSplit?.collapse?.();
					const ex = app.vault.getAbstractFileByPath(folder);
					if (ex) await app.vault.delete(ex, true);
					await app.vault.createFolder(folder);
					await app.vault.create(folder + '/MobileBatchAlpha.md', 'Mobile E2E document mentioning MobileBatchBeta in plain text.');
					await app.vault.create(folder + '/MobileBatchBeta.md', 'Mobile E2E document mentioning MobileBatchAlpha in plain text.');
					await new Promise((r) => setTimeout(r, 250));

					app.workspace.getLeavesOfType('lumina-batch-studio').forEach((l) => l.detach());
					app.commands.executeCommandById('lumina:open-batch-studio');
					const dDead = Date.now() + 3500;
					while (Date.now() < dDead) {
						if (document.querySelector('div.lumina-batch-studio')) break;
						await new Promise((r) => setTimeout(r, 100));
					}
					await new Promise((r) => setTimeout(r, 200));

					const studio = document.querySelector('div.lumina-batch-studio');
					const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
					studio.querySelector('.lumina-batch-main-tab[data-tab="workspace"]')?.click();
					await new Promise((r) => setTimeout(r, 100));
					studio.querySelector('.lumina-batch-collapsed-bar button')?.click();
					await new Promise((r) => setTimeout(r, 100));
					studio.querySelectorAll('.lumina-batch-recipe-tab')[1]?.click();
					await new Promise((r) => setTimeout(r, 150));
					studio.querySelectorAll('.lumina-batch-segmented button')[1]?.click();
					await new Promise((r) => setTimeout(r, 100));
					const fIn = studio.querySelector('input[list="lumina-batch-folder-list"]');
					if (fIn) {
						setter.call(fIn, folder);
						fIn.dispatchEvent(new Event('input', { bubbles: true }));
					}
					await new Promise((r) => setTimeout(r, 250));
					studio.querySelector('.lumina-batch-start-btn')?.click();
					const rDead = Date.now() + 8000;
					while (Date.now() < rDead) {
						if (studio.querySelector('.lumina-batch-status-pill.is-completed') && studio.querySelector('.lumina-batch-workbench')) break;
						await new Promise((r) => setTimeout(r, 100));
					}

					const wbHeight = Math.round(studio.querySelector('.lumina-batch-workbench')?.getBoundingClientRect().height || 0);
					studio.querySelector('.lumina-batch-collapsed-bar button')?.click();
					await new Promise((r) => setTimeout(r, 150));
					const wbHeightExpanded = Math.round(studio.querySelector('.lumina-batch-workbench')?.getBoundingClientRect().height || 0);

					// 실제 모바일 일괄 적용 검증
					studio.querySelector('.lumina-batch-bulk-apply-btn')?.click();
					await new Promise((r) => setTimeout(r, 400));
					const cA = await app.vault.read(app.vault.getAbstractFileByPath(folder + '/MobileBatchAlpha.md'));
					const appliedOnMobile = cA.includes('[[MobileBatchBeta]]');

					const noOverflow = studio.scrollWidth <= studio.clientWidth + 4;
					studio.querySelector('.lumina-batch-main-tab[data-tab="orphans"]')?.click();
					await new Promise((r) => setTimeout(r, 150));
					const orphanPane = studio.querySelector('.lumina-orphan-tab');
					const orphanOk = orphanPane ? orphanPane.scrollWidth <= orphanPane.clientWidth + 4 : false;
					studio.querySelector('.lumina-batch-main-tab[data-tab="watch"]')?.click();
					await new Promise((r) => setTimeout(r, 150));
					const watchPane = studio.querySelector('.lumina-watch-pane');
					const watchOk = watchPane ? watchPane.scrollWidth <= watchPane.clientWidth + 4 : false;

					return {
						success: wbHeight >= 120 && wbHeightExpanded >= 120 && appliedOnMobile && noOverflow && orphanOk && watchOk,
						wbHeight,
						wbHeightExpanded,
						appliedOnMobile,
						noOverflow,
						orphanOk,
						watchOk,
					};
				} finally {
					app.workspace.getLeavesOfType('lumina-batch-studio').forEach((l) => l.detach());
					const f = app.vault.getAbstractFileByPath(folder);
					if (f) await app.vault.delete(f, true);
				}
			})()`);

			reporter.record(
				'Mobile Batch Studio (Pro): Apply on Disk, Workbench Height & Zero Overflow',
				mobBatchRes.success,
				`Applied=${mobBatchRes.appliedOnMobile}, WorkbenchH=${mobBatchRes.wbHeight}/${mobBatchRes.wbHeightExpanded}px, OverflowOK=${mobBatchRes.noOverflow}/${mobBatchRes.orphanOk}/${mobBatchRes.watchOk}`,
				Date.now() - tMobBatch,
			);
		},
		{
			voiceNote: {
				audioFolder: '__lumina_e2e_voice_audio__',
				llmProviderId: '__e2e_mock_prov__',
				llmModelId: 'mock-model-a',
				defaultTemplate: 'clean',
			},
		},
	);
}
