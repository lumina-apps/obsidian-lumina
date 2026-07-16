import { setIcon } from 'obsidian';

/** 개행 포함 설명 텍스트를 DOM 요소로 변환하여 컨테이너에 추가 */
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

/** 개행 포함 텍스트 → DocumentFragment (Setting.setDesc() 용) */
export function createMultilineDesc(text: string): DocumentFragment {
	const frag = document.createDocumentFragment();
	text.split('\n').forEach((line, i) => {
		if (i > 0) {
			frag.appendChild(document.createElement('br'));
		}
		frag.append(line);
	});
	return frag;
}

/** feature-card 생성 (MCP 탭용) */
export function createFeatureCard(el: HTMLElement, active: boolean): HTMLDivElement {
	const cls = 'lumina-feature-card' + (active ? ' is-active' : '');
	return el.createDiv({ cls });
}

/** 중앙 정렬된 버튼 컨테이너 생성 */
export function createButtonContainer(el: HTMLElement, cls: string): HTMLDivElement {
	const container = el.createDiv({ cls });
	container.setCssStyles({ display: 'flex', justifyContent: 'center', margin: '10px 0' });
	return container;
}

/** Svelte use: 액션 — setIcon(node, iconId) 호출 */
export function iconAction(node: HTMLElement, iconId: string) {
	setIcon(node, iconId);
}

/** Svelte use: 액션 — 요소 외부 클릭 감지 */
export function clickOutside(node: HTMLElement, callback: () => void) {
	function handler(e: MouseEvent) {
		if (!node.contains(e.target as Node)) {
			callback();
		}
	}
	const timer = window.setTimeout(() => {
		activeDocument.addEventListener('click', handler);
	}, 0);
	return {
		destroy() {
			window.clearTimeout(timer);
			activeDocument.removeEventListener('click', handler);
		},
	};
}
