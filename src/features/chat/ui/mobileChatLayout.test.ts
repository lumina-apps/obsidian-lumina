import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

/**
 * 모바일 채팅뷰 반응형 스타일이 데스크탑 CSS에 영향을 주지 않고
 * 모든 규칙이 body.is-mobile 스코프 하위에 안전하게 격리되어 있는지 검증합니다.
 */
describe('Mobile Chat View Layout CSS Isolation & Completeness', () => {
	const rootDir = path.resolve(__dirname, '../../../..');
	const stylesPath = path.join(rootDir, 'styles.css');

	/**
	 * CSS 문자열에서 주석을 제거한 뒤 규칙 선택자 목록을 재귀적으로 추출합니다.
	 * @media / @container 같은 중첩 블록 내부의 실제 규칙 선택자까지 모두 풀어내어 검증합니다.
	 */
	function splitTopLevelCommas(rawSelector: string): string[] {
		const parts: string[] = [];
		let parenDepth = 0;
		let bracketDepth = 0;
		let current = '';

		for (let i = 0; i < rawSelector.length; i++) {
			const ch = rawSelector[i];
			if (ch === '(') parenDepth++;
			else if (ch === ')' && parenDepth > 0) parenDepth--;
			else if (ch === '[') bracketDepth++;
			else if (ch === ']' && bracketDepth > 0) bracketDepth--;

			if (ch === ',' && parenDepth === 0 && bracketDepth === 0) {
				const trimmed = current.trim();
				if (trimmed) parts.push(trimmed);
				current = '';
			} else {
				current += ch;
			}
		}

		const tail = current.trim();
		if (tail) parts.push(tail);
		return parts;
	}

	function extractSelectors(css: string): string[] {
		const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
		const selectors: string[] = [];
		let i = 0;
		let headerBuffer = '';

		while (i < withoutComments.length) {
			const ch = withoutComments[i];
			if (ch === '{') {
				const header = headerBuffer.trim();
				headerBuffer = '';

				const blockStart = i + 1;
				let depth = 1;
				i++;
				while (i < withoutComments.length && depth > 0) {
					if (withoutComments[i] === '{') depth++;
					else if (withoutComments[i] === '}') depth--;
					i++;
				}
				const blockBody = withoutComments.slice(blockStart, Math.max(blockStart, i - 1));

				if (header.startsWith('@media') || header.startsWith('@container') || header.startsWith('@supports')) {
					selectors.push(...extractSelectors(blockBody));
				} else if (header && !header.startsWith('@')) {
					selectors.push(...splitTopLevelCommas(header));
				}
				continue;
			}
			headerBuffer += ch;
			i++;
		}

		return selectors;
	}

	/**
	 * CSS 중괄호 짝이 올바른지 확인합니다.
	 */
	function hasBalancedBraces(css: string): boolean {
		const withoutComments = css.replace(/\/\*[\s\S]*?\*\//g, '');
		let depth = 0;
		for (const ch of withoutComments) {
			if (ch === '{') depth++;
			else if (ch === '}') {
				depth--;
				if (depth < 0) return false;
			}
		}
		return depth === 0;
	}

	it('styles.css의 모바일 채팅 섹션 내 모든 선택자가 body.is-mobile로 시작한다', () => {
		const stylesContent = fs.readFileSync(stylesPath, 'utf8');
		expect(hasBalancedBraces(stylesContent)).toBe(true);

		const marker = '/* ─── Mobile Chat View Responsive Overrides (.is-mobile scoped) ───────────── */';
		const markerIndex = stylesContent.indexOf(marker);
		expect(markerIndex).toBeGreaterThan(-1);

		const mobileSection = stylesContent.slice(markerIndex);
		const selectors = extractSelectors(mobileSection);
		expect(selectors.length).toBeGreaterThan(10);

		for (const selector of selectors) {
			expect(
				selector.startsWith('body.is-mobile'),
				`비모바일 누출 선택자 감지: ${selector}`,
			).toBe(true);
		}
	});

	it('styles.css에 모바일 채팅 헤더·툴바·입력창·팝업 핵심 규칙이 모두 포함되어 있다', () => {
		const stylesContent = fs.readFileSync(stylesPath, 'utf8');
		const requiredSnippets = [
			'body.is-mobile .view-content.lumina-chat-view',
			'body.is-mobile .lumina-chat__header',
			'body.is-mobile .lumina-chat__actions',
			'body.is-mobile .lumina-chat__controls',
			'body.is-mobile .lumina-chat__header .lumina-model-selector',
			'body.is-mobile .lumina-chat__rag-badge',
			'body.is-mobile .lumina-chat__toggle-btn',
			'body.is-mobile .lumina-chat__input-area',
			'body.is-mobile .lumina-chat__input-toolbar',
			'body.is-mobile .lumina-chat__hint-inline',
			'body.is-mobile .lumina-chat__context-badge',
			'body.is-mobile .lumina-chat__input-container > .lumina-popup-selector',
		];

		for (const snippet of requiredSnippets) {
			expect(stylesContent, `누락된 모바일 규칙: ${snippet}`).toContain(snippet);
		}
	});

	it('수정된 모든 채팅 Svelte 컴포넌트가 :global(body.is-mobile) 스코프와 올바른 CSS 문법을 유지한다', () => {
		const componentChecks: Array<{ relPath: string; expectedSelectors: string[] }> = [
			{
				relPath: 'src/features/chat/ui/Sidebar.svelte',
				expectedSelectors: [':global(body.is-mobile) .lumina-sidebar__tabs', ':global(body.is-mobile) .lumina-sidebar__tab'],
			},
			{
				relPath: 'src/features/chat/ui/ModelSelector.svelte',
				expectedSelectors: [':global(body.is-mobile) .lumina-model-selector', ':global(body.is-mobile) .lumina-model-selector__trigger'],
			},
			{
				relPath: 'src/features/chat/ui/ProjectSelector.svelte',
				expectedSelectors: [':global(body.is-mobile) .lumina-project-selector__trigger', ':global(body.is-mobile) .lumina-project-selector__dropdown'],
			},
			{
				relPath: 'src/features/chat/ui/QuickSettings.svelte',
				expectedSelectors: [':global(body.is-mobile) .lumina-qs'],
			},
			{
				relPath: 'src/features/chat/ui/lib/quickSettings/QuickSettingsGroup.svelte',
				expectedSelectors: [':global(body.is-mobile) .lumina-qs__btn'],
			},
			{
				relPath: 'src/features/chat/ui/SlashCommandSelector.svelte',
				expectedSelectors: [':global(body.is-mobile) .lumina-slash-selector__item-badge'],
			},
			{
				relPath: 'src/features/chat/ui/McpQuickPopup.svelte',
				expectedSelectors: [':global(body.is-mobile) .lumina-mcp-popup'],
			},
			{
				relPath: 'src/features/chat/ui/ModelPickerPopup.svelte',
				expectedSelectors: [':global(body.is-mobile) .lumina-model-picker'],
			},
			{
				relPath: 'src/features/chat/ui/PromptPickerPopup.svelte',
				expectedSelectors: [':global(body.is-mobile) .lumina-prompt-picker'],
			},
			{
				relPath: 'src/features/chat/ui/Message.svelte',
				expectedSelectors: [
					':global(body.is-mobile) .lumina-message--user',
					':global(body.is-mobile) .lumina-message__header',
					':global(body.is-mobile) .lumina-message__role',
					':global(body.is-mobile) .lumina-message :global(.clickable-icon.lumina-message__action-btn)',
				],
			},
			{
				relPath: 'src/features/chat/ui/ChatHistoryList.svelte',
				expectedSelectors: [
					':global(body.is-mobile) .lumina-history__item-main',
					':global(body.is-mobile) .lumina-history__actions',
				],
			},
			{
				relPath: 'src/features/chat/ui/InlineApprovalQueue.svelte',
				expectedSelectors: [
					':global(body.is-mobile) .lumina-inline-approval-header',
					':global(body.is-mobile) .lumina-inline-approval-path',
				],
			},
			{
				relPath: 'src/features/chat/ui/components/ToolCallBlock.svelte',
				expectedSelectors: [':global(body.is-mobile) .lumina-cli-tool-call__approval-bar'],
			},
			{
				relPath: 'src/features/chat/ui/components/FileEditBadge.svelte',
				expectedSelectors: [':global(body.is-mobile) .lumina-cli-file-edit'],
			},
		];

		for (const { relPath, expectedSelectors } of componentChecks) {
			const fullPath = path.join(rootDir, relPath);
			const content = fs.readFileSync(fullPath, 'utf8');
			const styleMatch = content.match(/<style>([\s\S]*?)<\/style>/);
			expect(styleMatch, `${relPath}에 <style> 블록이 존재해야 함`).toBeTruthy();

			const styleBody = styleMatch![1];
			expect(hasBalancedBraces(styleBody), `${relPath} <style> 중괄호 불일치`).toBe(true);

			for (const selector of expectedSelectors) {
				expect(styleBody, `${relPath} 누락 선택자: ${selector}`).toContain(selector);
			}
		}
	});

	it('styles.css에 모바일 설정·프로젝트 모달·디버그·에디터·대화상자 반응형 규칙이 모두 포함되어 있다', () => {
		const stylesContent = fs.readFileSync(stylesPath, 'utf8');
		expect(hasBalancedBraces(stylesContent)).toBe(true);

		const compatStart = 'body.is-mobile .vertical-tab-content-container .vertical-tab-content.lumina-settings';
		const compatIndex = stylesContent.indexOf(compatStart);
		expect(compatIndex).toBeGreaterThan(-1);

		const fullMobileCss = stylesContent.slice(compatIndex);
		const selectors = extractSelectors(fullMobileCss);
		for (const selector of selectors) {
			expect(
				selector.startsWith('body.is-mobile'),
				`모바일 영역 비격리 선택자 감지: ${selector}`,
			).toBe(true);
		}

		const requiredSnippets = [
			'button.lumina-settings__nav-btn:not(.lumina-settings__nav-btn--advanced)',
			'.lumina-dropdown-ellipsis',
			'input[type="range"]',
			'textarea.lumina-prompt-card__content',
			'.lumina-provider-card.mcp-server-card > .setting-item',
			'body.is-mobile .vertical-tab-content-container .lumina-settings .lumina-feature-card .setting-item-info',
			'body.is-mobile.is-phone .vertical-tab-content-container .lumina-settings .setting-item',
			'body.is-mobile.is-floating-nav:not(.is-hidden-nav) .view-content.lumina-split-view',
			'body.is-mobile .lumina-settings-modal .setting-item',
			'body.is-mobile .lumina-debug__table td:first-child',
			'body.is-mobile .cm-tooltip.lumina-promptbar .lumina-promptbar-kbd',
			'body.is-mobile .lumina-cli-diff-modal__path',
		];

		for (const snippet of requiredSnippets) {
			expect(stylesContent, `누락된 모바일 설정/모달 규칙: ${snippet}`).toContain(snippet);
		}
	});

	it('Smart Discovery·Split Chat·Batch·Voice·Debug Svelte 컴포넌트도 모바일 스코프와 올바른 CSS 문법을 유지한다', () => {
		const componentChecks: Array<{ relPath: string; expectedSelectors: string[] }> = [
			{
				relPath: 'src/features/rag/ui/DiscoveryCard.svelte',
				expectedSelectors: [':global(body.is-mobile) .lumina-discovery__card-actions', ':global(body.is-mobile) .lumina-discovery__action-btn'],
			},
			{
				relPath: 'src/features/rag/ui/components/DiscoverySearchBar.svelte',
				expectedSelectors: [':global(body.is-mobile) .lumina-discovery__search-bar', ':global(body.is-mobile) .lumina-discovery__clear-btn'],
			},
			{
				relPath: 'src/features/rag/ui/DiscoveryStagingArea.svelte',
				expectedSelectors: [':global(body.is-mobile) .lumina-discovery__staging-area', ':global(body.is-mobile) .lumina-discovery__start-chat-btn'],
			},
			{
				relPath: 'src/features/chat/split/ui/SplitHeader.svelte',
				expectedSelectors: [':global(body.is-mobile) .lumina-split-header', ':global(body.is-mobile) .clickable-icon.lumina-split-header__icon-btn'],
			},
			{
				relPath: 'src/features/chat/split/ui/SplitSlotBar.svelte',
				expectedSelectors: [':global(body.is-mobile) .lumina-split-slotbar', ':global(body.is-mobile) .clickable-icon.lumina-split-slotbar__tool-btn'],
			},
			{
				relPath: 'src/features/chat/split/ui/SplitTurnRow.svelte',
				expectedSelectors: [':global(body.is-mobile) .clickable-icon.lumina-split-turn__prompt-btn'],
			},
			{
				relPath: 'src/features/chat/split/ui/SplitResponseCard.svelte',
				expectedSelectors: [':global(body.is-mobile) .clickable-icon.lumina-split-card__action-btn', ':global(body.is-mobile) .lumina-split-card__content :global(table)'],
			},
			{
				relPath: 'src/features/chat/split/ui/SplitFocusModal.svelte',
				expectedSelectors: [':global(body.is-mobile) .lumina-split-focus-backdrop', ':global(body.is-mobile) .clickable-icon.lumina-split-focus-modal__btn'],
			},
			{
				relPath: 'src/features/chat/split/ui/SplitHistoryDrawer.svelte',
				expectedSelectors: [':global(body.is-mobile) .lumina-split-drawer', ':global(body.is-mobile) .lumina-split-drawer__action-btn'],
			},
			{
				relPath: 'src/features/batch/ui/BatchStudioPanel.svelte',
				expectedSelectors: [
					':global(body.is-mobile) .lumina-batch-field-row',
					':global(body.is-mobile) .lumina-batch-inspector-path',
					':global(body.is-mobile) .lumina-batch-studio button',
				],
			},
			{
				relPath: 'src/features/voice/ui/VoiceRecorderPill.svelte',
				expectedSelectors: ['.is-mobile .lumina-voice-controls', '.is-mobile .lumina-voice-status-text'],
			},
			{
				relPath: 'src/features/debug/ui/DebugFilterBar.svelte',
				expectedSelectors: [':global(body.is-mobile) .lumina-debug__filter-btn'],
			},
		];

		for (const { relPath, expectedSelectors } of componentChecks) {
			const fullPath = path.join(rootDir, relPath);
			const content = fs.readFileSync(fullPath, 'utf8');
			const styleMatch = content.match(/<style>([\s\S]*?)<\/style>/);
			expect(styleMatch, `${relPath}에 <style> 블록이 존재해야 함`).toBeTruthy();

			const styleBody = styleMatch![1];
			expect(hasBalancedBraces(styleBody), `${relPath} <style> 중괄호 불일치`).toBe(true);

			for (const selector of expectedSelectors) {
				expect(styleBody, `${relPath} 누락 선택자: ${selector}`).toContain(selector);
			}
		}
	});

	it('태블릿 환경을 위한 컨테이너 쿼리·뷰포트 분기 및 Platform.isPhone 분기가 올바르게 구성되어 있다', () => {
		const stylesContent = fs.readFileSync(stylesPath, 'utf8');
		expect(stylesContent).toContain('@container (max-width: 600px)');
		expect(stylesContent).toContain('@container (max-width: 520px)');
		expect(stylesContent).toContain('body.is-mobile .lumina-chat {\n\tcontainer-type: inline-size;');
		expect(stylesContent).toContain('body.is-mobile .lumina-settings-modal {\n\tcontainer-type: inline-size;');

		const splitPanelContent = fs.readFileSync(
			path.join(rootDir, 'src/features/chat/split/ui/SplitChatPanel.svelte'),
			'utf8',
		);
		expect(splitPanelContent).toContain('Boolean(Platform.isPhone) || containerWidth < 680');
		expect(splitPanelContent).not.toContain('Platform.isMobile || containerWidth < 680');

		const modelSelectorContent = fs.readFileSync(
			path.join(rootDir, 'src/features/chat/ui/ModelSelector.svelte'),
			'utf8',
		);
		expect(modelSelectorContent).toContain('viewportW > 600');
		expect(modelSelectorContent).toContain('@container (max-width: 520px)');

		const batchContent = fs.readFileSync(
			path.join(rootDir, 'src/features/batch/ui/BatchStudioPanel.svelte'),
			'utf8',
		);
		expect(batchContent).toContain(':global(body.is-mobile) .lumina-batch-studio {\n\t\tcontainer-type: inline-size;');
		expect(batchContent).toContain('@container (max-width: 720px)');

		for (const voiceRelPath of [
			'src/features/voice/ui/VoiceRecorderPill.svelte',
			'src/features/voice/ui/VoicePostActionBar.svelte',
		]) {
			const voiceContent = fs.readFileSync(path.join(rootDir, voiceRelPath), 'utf8');
			expect(voiceContent).toContain('bottom: calc(64px + env(safe-area-inset-bottom, 0px));');
			expect(voiceContent).toContain('max-width: min(680px, calc(100vw - 32px));');
			expect(voiceContent).toContain('@media (max-width: 600px)');
		}

		const discoveryPanelContent = fs.readFileSync(
			path.join(rootDir, 'src/features/rag/ui/DiscoveryPanel.svelte'),
			'utf8',
		);
		expect(discoveryPanelContent).toContain(':global(body.is-mobile) .lumina-discovery {\n\t\tcontainer-type: inline-size;');

		const discoveryCardContent = fs.readFileSync(
			path.join(rootDir, 'src/features/rag/ui/DiscoveryCard.svelte'),
			'utf8',
		);
		expect(discoveryCardContent).toContain('@container (max-width: 440px)');

		for (const chatSubPath of [
			'src/features/chat/ui/QuickSettings.svelte',
			'src/features/chat/ui/McpQuickPopup.svelte',
			'src/features/chat/ui/ModelPickerPopup.svelte',
			'src/features/chat/ui/PromptPickerPopup.svelte',
			'src/features/chat/ui/Message.svelte',
		]) {
			const chatContent = fs.readFileSync(path.join(rootDir, chatSubPath), 'utf8');
			expect(chatContent, `${chatSubPath}에 @container (max-width: 520px) 누락`).toContain('@container (max-width: 520px)');
		}

		const focusModalContent = fs.readFileSync(
			path.join(rootDir, 'src/features/chat/split/ui/SplitFocusModal.svelte'),
			'utf8',
		);
		expect(focusModalContent).toContain('@media (max-width: 600px)');
	});

	it('styles.css에 Obsidian CSS 린트 경고 유발 구문(!important, column-gap, display: contents)이 없어야 한다', () => {
		const stylesContent = fs.readFileSync(stylesPath, 'utf8');
		const withoutComments = stylesContent.replace(/\/\*[\s\S]*?\*\//g, '');

		expect(withoutComments).not.toMatch(/!important\b/);
		expect(withoutComments).not.toMatch(/\bcolumn-gap\s*:/);
		expect(withoutComments).not.toMatch(/\bdisplay\s*:\s*contents\b/);
	});
});
