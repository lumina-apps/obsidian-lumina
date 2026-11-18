/** 개행 포함 텍스트 → DocumentFragment (Setting.setDesc() 용) */
export function createMultilineDesc(text: string): DocumentFragment {
	return createFragment((frag) => {
		text.split('\n').forEach((line, i) => {
			if (i > 0) {
				frag.createEl('br');
			}
			frag.append(line);
		});
	});
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

import { icon } from './iconAction';

/** Svelte use: 액션 — setIcon(node, iconId) 호출 및 반응형 업데이트 지원 */
export const iconAction = icon;

/** Svelte use: 액션 — 요소 외부 클릭 감지 */
export function clickOutside(node: HTMLElement, callback: () => void) {
	function handler(e: MouseEvent) {
		const path = e.composedPath ? e.composedPath() : [];
		if (path.includes(node) || node.contains(e.target as Node)) {
			return;
		}
		callback();
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
