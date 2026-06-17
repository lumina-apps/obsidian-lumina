import { setIcon } from 'obsidian';

/**
 * DOM 생성 공통 유틸리티.
 * 모달(ConfirmModal, AgentBetaModal, McpPermissionModal)에서
 * 개행 포함 설명 텍스트를 DOM 요소로 변환하는 중복 패턴 제거.
 */

/**
 * 개행이 포함된 설명 텍스트를 DOM 요소로 변환하여 container에 추가합니다.
 * 빈 줄은 <br>로 렌더링됩니다.
 *
 * @param container 부모 HTMLElement
 * @param text 개행(\n)을 포함한 설명 텍스트
 * @param options.tag 생성할 요소 태그 (기본: 'p')
 * @param options.className 각 요소에 추가할 CSS 클래스 (선택)
 */
export function renderDescriptionLines(
	container: HTMLElement,
	text: string,
	options?: { tag?: 'p' | 'span'; className?: string },
): void {
	const tag = options?.tag ?? 'p';
	const cls = options?.className;
	const lines = text.split('\n');

	for (const line of lines) {
		if (line.trim() === '') {
			container.createEl('br');
		} else {
			const el = container.createEl(tag, { text: line });
			if (cls) {
				el.addClass(cls);
			}
		}
	}
}

/**
 * 개행 포함 텍스트를 DocumentFragment로 변환합니다.
 * Obsidian의 activeDocument를 사용하여 생성합니다.
 * (Setting.setDesc()에 DocumentFragment를 전달할 때 사용)
 *
 * @param text 개행(\n)을 포함한 설명 텍스트
 * @returns DocumentFragment
 */
export function createMultilineDesc(text: string): DocumentFragment {
	const frag = activeDocument.createDocumentFragment();
	text.split('\n').forEach((line, i) => {
		if (i > 0) frag.createEl('br');
		frag.appendText(line);
	});
	return frag;
}

/**
 * feature-card 생성: is-active 클래스는 active일 때만 추가합니다.
 * MCP 탭의 LocalServerSection, AgentSection에서 사용.
 */
export function createFeatureCard(el: HTMLElement, active: boolean): HTMLDivElement {
	const cls = 'lumina-feature-card' + (active ? ' is-active' : '');
	return el.createDiv({ cls });
}

/**
 * 중앙 정렬된 버튼 컨테이너를 생성합니다.
 * display: flex, justify-content: center, margin: 10px 0
 */
export function createButtonContainer(el: HTMLElement, cls: string): HTMLDivElement {
	const container = el.createDiv({ cls });
	container.setCssStyles({ display: 'flex', justifyContent: 'center', margin: '10px 0' });
	return container;
}

/**
 * Svelte use: 액션 — setIcon(node, iconId)를 호출합니다.
 * DiscoveryPanel, DiscoveryCard, DiscoveryStagingArea 등에서 중복 정의되던 패턴을 통합.
 *
 * 사용법: <span use:iconAction={"search"}></span>
 */
export function iconAction(node: HTMLElement, iconId: string) {
	setIcon(node, iconId);
}

/**
 * Svelte use: 액션 — 요소 외부 클릭 감지.
 * setTimeout(0)으로 이벤트 등록 타이밍을 지연시켜
 * 팝업을 연 동일 클릭 이벤트에서 즉시 닫히는 것을 방지합니다.
 *
 * 사용법: <div use:clickOutside={onClose}></div>
 */
export function clickOutside(node: HTMLElement, callback: () => void) {
	function handler(e: MouseEvent) {
		if (!node.contains(e.target as Node)) {
			callback();
		}
	}
	const timer = setTimeout(() => {
		document.addEventListener('click', handler);
	}, 0);
	return {
		destroy() {
			clearTimeout(timer);
			document.removeEventListener('click', handler);
		},
	};
}
