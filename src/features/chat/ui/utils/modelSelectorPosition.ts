/**
 * 모델 선택 드롭다운의 위치 계산에 필요한 사각형 정보
 */
export interface DropdownRectLike {
	left: number;
	right: number;
	width: number;
}

/**
 * 데스크탑 모델 선택 드롭다운 위치 계산 파라미터
 */
export interface DesktopDropdownPositionParams {
	triggerRect: DropdownRectLike;
	hostRect: DropdownRectLike | null;
	dropdownAlign: "left" | "right";
	preferredWidth?: number;
	edgePadding?: number;
}

/**
 * 데스크탑 환경에서 모델 선택 드롭다운이 호스트 컨테이너(.lumina-chat, .lumina-split-root)
 * 좌우 경계를 벗어나 잘리지 않도록 트리거 기준 인라인 스타일을 계산합니다.
 */
export function computeDesktopModelDropdownStyle({
	triggerRect,
	hostRect,
	dropdownAlign,
	preferredWidth = 360,
	edgePadding = 8,
}: DesktopDropdownPositionParams): string | undefined {
	if (!hostRect || hostRect.width <= 0) {
		return undefined;
	}

	const availableWidth = Math.floor(hostRect.width - edgePadding * 2);
	if (availableWidth <= 0) {
		return undefined;
	}

	const dropdownWidth = Math.min(preferredWidth, availableWidth);
	const relLeft = triggerRect.left - hostRect.left;
	const relRight = triggerRect.right - hostRect.left;
	const rawLeft = dropdownAlign === "left" ? relLeft : relRight - dropdownWidth;
	const minLeft = edgePadding;
	const maxLeft = Math.max(edgePadding, hostRect.width - edgePadding - dropdownWidth);
	const clampedLeft = Math.max(minLeft, Math.min(rawLeft, maxLeft));
	const offsetLeft = Math.round(clampedLeft - relLeft);

	return `left: ${offsetLeft}px; right: auto; width: ${dropdownWidth}px; max-width: ${availableWidth}px;`;
}
