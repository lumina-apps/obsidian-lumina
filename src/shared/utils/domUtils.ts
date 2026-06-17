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
 * 중앙 정렬된 버튼 컨테이너를 생성합니다.
 * display: flex, justify-content: center, margin: 10px 0
 */
export function createButtonContainer(el: HTMLElement, cls: string): HTMLDivElement {
	const container = el.createDiv({ cls });
	container.setCssStyles({ display: 'flex', justifyContent: 'center', margin: '10px 0' });
	return container;
}
