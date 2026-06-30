import { setIcon } from "obsidian";

/**
 * Svelte `use:icon` 액션.
 * 주어진 HTMLElement에 Obsidian setIcon을 적용하고,
 * 아이콘 ID가 변경되면 자동으로 업데이트한다.
 *
 * @example
 * <span use:icon={"copy"}></span>
 * <span use:icon={dynamicIconId}></span>
 */
export function icon(node: HTMLElement, iconId: string) {
	const removeTooltips = (el: HTMLElement) => {
		el.removeAttribute("aria-label");
		const svg = el.querySelector("svg");
		if (svg) {
			svg.removeAttribute("aria-label");
			const title = svg.querySelector("title");
			if (title) title.remove();
		}
	};

	setIcon(node, iconId);
	removeTooltips(node);

	return {
		update(newIconId: string) {
			node.empty();
			setIcon(node, newIconId);
			removeTooltips(node);
		},
	};
}
