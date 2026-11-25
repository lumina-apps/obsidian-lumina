import { Platform } from "obsidian";
import { debugLogger } from "../../../../shared/debugLogger";

interface VirtualKeyboardLike {
	boundingRect?: { height?: number };
	addEventListener?: (type: string, listener: EventListener) => void;
	removeEventListener?: (type: string, listener: EventListener) => void;
}

/**
 * 모바일(iOS/Android) 환경에서 가상 키보드가 올라올 때 채팅 입력창이 가려지지 않도록
 * window.visualViewport를 감시하여 키보드가 입력창 하단을 침범하는 높이만큼
 * `--lumina-keyboard-offset` CSS 변수와 `is-keyboard-open` 클래스를 갱신합니다.
 */
export interface MobileKeyboardViewportOptions {
	/** 키보드 오프셋 CSS 변수 및 클래스를 적용할 대상 컨테이너 (예: .lumina-chat__input-area) */
	getContainerEl: () => HTMLElement | null;
	/** 포커스 여부를 확인할 입력 요소 (선택, 미지정 시 container 내부 포커스 여부로 판단) */
	getInputEl?: () => HTMLElement | null;
	/** 키보드가 열렸을 때 메시지 목록을 하단으로 스크롤하는 등 추가 동작 콜백 */
	onKeyboardOpen?: (offsetPx: number) => void;
}

export interface MobileKeyboardViewportController {
	/** 수동으로 현재 뷰포트 기준 오프셋을 즉시 재계산합니다 (focus/blur 이벤트 등). */
	update: () => void;
	/** 등록된 이벤트 리스너 및 타이머를 정리합니다. */
	destroy: () => void;
}

/** 키보드가 열린 것으로 판정할 최소 화면 침범 높이 (px) */
const KEYBOARD_OPEN_THRESHOLD_PX = 80;

/**
 * 현재 컨테이너 하단(bottom)과 가시 영역 하단 사이의 가려진 높이(px)를 계산합니다.
 * Obsidian 모바일이 이미 컨테이너 높이를 줄여주어 침범이 없는 경우 0을 반환하여 이중 여백을 방지합니다.
 */
export function calculateKeyboardOverlapPx(
	containerRectBottom: number,
	viewportHeight: number,
	viewportOffsetTop: number,
	obsidianKeyboardHeight: number = 0,
	layoutViewportHeight: number = viewportHeight,
): number {
	const visualBottom = viewportHeight + viewportOffsetTop;
	const obsidianVisibleBottom =
		obsidianKeyboardHeight > 0
			? Math.max(0, layoutViewportHeight - obsidianKeyboardHeight)
			: visualBottom;
	const visibleBottom = Math.min(visualBottom, obsidianVisibleBottom);
	const overlap = Math.round(containerRectBottom - visibleBottom);
	return overlap > 0 ? overlap : 0;
}

/**
 * Obsidian 모바일(Capacitor)이 document.documentElement(:root)에 주입하는
 * `--keyboard-height` CSS 변수 값을 px 단위 정수로 읽어옵니다.
 */
export function readObsidianKeyboardHeight(): number {
	if (typeof window === "undefined" || typeof document === "undefined") return 0;
	const docEl = document.documentElement;
	if (!docEl) return 0;
	const inlineVal =
		docEl.style?.getPropertyValue("--keyboard-height") ||
		document.body?.style?.getPropertyValue("--keyboard-height") ||
		"";
	const raw =
		inlineVal.trim() ||
		window.getComputedStyle(docEl).getPropertyValue("--keyboard-height").trim();
	const parsed = Number.parseFloat(raw);
	return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : 0;
}

export function setupMobileKeyboardViewport(
	options: MobileKeyboardViewportOptions,
): MobileKeyboardViewportController {
	let rafId: number | null = null;
	let settleTimerId: number | null = null;
	let lateSettleTimerId: number | null = null;
	let lastAppliedOffset = 0;
	let wasKeyboardOpen = false;

	const isMobileEnv = (): boolean => {
		if (typeof Platform !== "undefined" && Platform.isMobile) {
			return true;
		}
		if (typeof document !== "undefined" && document.body?.classList.contains("is-mobile")) {
			return true;
		}
		return false;
	};

	const hasActiveInputFocus = (containerEl: HTMLElement): boolean => {
		const inputEl = options.getInputEl?.();
		const activeEl = typeof document !== "undefined" ? document.activeElement : null;
		if (!activeEl) return false;
		if (inputEl && activeEl === inputEl) return true;
		return containerEl.contains(activeEl);
	};

	const applyOffset = (containerEl: HTMLElement, offsetPx: number, isKeyboardOpen: boolean): void => {
		containerEl.style.setProperty("--lumina-keyboard-offset", `${offsetPx}px`);
		containerEl.classList.toggle("is-keyboard-open", isKeyboardOpen);
	};

	const measureAndApply = (): void => {
		const containerEl = options.getContainerEl();
		if (!containerEl) return;

		if (!isMobileEnv() || typeof window === "undefined") {
			if (lastAppliedOffset !== 0 || wasKeyboardOpen) {
				lastAppliedOffset = 0;
				wasKeyboardOpen = false;
				applyOffset(containerEl, 0, false);
			}
			return;
		}

		const vv = window.visualViewport;
		const isFocused = hasActiveInputFocus(containerEl);
		const vk = (typeof navigator !== "undefined"
			? (navigator as Navigator & { virtualKeyboard?: VirtualKeyboardLike }).virtualKeyboard
			: undefined);
		const vkHeight = Math.round(vk?.boundingRect?.height ?? 0);
		const obsidianKeyboardHeight = readObsidianKeyboardHeight();

		// padding-bottom은 컨테이너 자신의 박스 크기를 늘려 top을 위로 밀어 올릴 뿐,
		// flex 컬럼 하단에 놓인 컨테이너의 bottom 좌표(가상 키보드 없을 때의 원래 바닥 위치)는 그대로 유지합니다.
		const rect = containerEl.getBoundingClientRect();
		const viewportHeight = vv ? vv.height : window.innerHeight;
		const viewportOffsetTop = vv ? vv.offsetTop : 0;
		const layoutHeight = window.innerHeight || document.documentElement.clientHeight || viewportHeight;

		const rawOverlap = calculateKeyboardOverlapPx(
			rect.bottom,
			viewportHeight,
			viewportOffsetTop,
			obsidianKeyboardHeight,
			layoutHeight,
		);

		// Android VirtualKeyboard API가 높이를 보고하지만 visualViewport가 줄지 않은 경우 보완
		const effectiveOverlap = rawOverlap > 0 ? rawOverlap : (isFocused && vkHeight > 0 ? vkHeight : 0);

		// visualViewport 전체 감소량 (OS가 레이아웃 뷰포트를 함께 줄이는 모드인지 판별)
		const viewportShrink = Math.round(layoutHeight - (viewportHeight + viewportOffsetTop));

		// 입력창에 포커스가 있거나 Obsidian --keyboard-height가 활성화된 상태에서 키보드 오픈 여부 판정
		const isKeyboardOpen =
			(isFocused &&
				(effectiveOverlap > 16 ||
					viewportShrink >= KEYBOARD_OPEN_THRESHOLD_PX ||
					obsidianKeyboardHeight >= KEYBOARD_OPEN_THRESHOLD_PX)) ||
			obsidianKeyboardHeight >= KEYBOARD_OPEN_THRESHOLD_PX;

		const nextOffset = isKeyboardOpen ? effectiveOverlap : 0;
		const prevWasOpen = wasKeyboardOpen;
		const prevOffset = lastAppliedOffset;

		lastAppliedOffset = nextOffset;
		wasKeyboardOpen = isKeyboardOpen;
		applyOffset(containerEl, nextOffset, isKeyboardOpen);

		if (isFocused || prevWasOpen !== isKeyboardOpen || prevOffset !== nextOffset) {
			debugLogger.logSystem(
				"mobile_keyboard",
				`focus=${isFocused} open=${isKeyboardOpen} offset=${nextOffset}px obsKb=${obsidianKeyboardHeight}px`,
				{
					innerHeight: window.innerHeight,
					vvHeight: viewportHeight,
					vvOffsetTop: viewportOffsetTop,
					rectBottom: Math.round(rect.bottom),
					obsidianKeyboardHeight,
					rawOverlap,
					vkHeight,
					viewportShrink,
					nextOffset,
				},
			);
		}

		if (isKeyboardOpen && (!prevWasOpen || nextOffset > prevOffset)) {
			options.onKeyboardOpen?.(nextOffset);
			const inputEl = options.getInputEl?.();
			if (inputEl && typeof inputEl.scrollIntoView === "function") {
				inputEl.scrollIntoView({ block: "nearest" });
			}
		}
	};

	const scheduleUpdate = (): void => {
		if (typeof window === "undefined") return;
		if (rafId !== null) {
			window.cancelAnimationFrame(rafId);
		}
		rafId = window.requestAnimationFrame(() => {
			rafId = null;
			measureAndApply();
		});

		// iOS/Android 키보드 스프링 애니메이션 종료 시점 재보정 (180ms + 360ms)
		if (settleTimerId !== null) {
			window.clearTimeout(settleTimerId);
		}
		settleTimerId = window.setTimeout(() => {
			settleTimerId = null;
			measureAndApply();
		}, 180);

		if (lateSettleTimerId !== null) {
			window.clearTimeout(lateSettleTimerId);
		}
		lateSettleTimerId = window.setTimeout(() => {
			lateSettleTimerId = null;
			measureAndApply();
		}, 360);
	};

	const vv = typeof window !== "undefined" ? window.visualViewport : null;
	if (vv) {
		vv.addEventListener("resize", scheduleUpdate);
		vv.addEventListener("scroll", scheduleUpdate);
	}
	const vk = typeof navigator !== "undefined"
		? (navigator as Navigator & { virtualKeyboard?: VirtualKeyboardLike }).virtualKeyboard
		: undefined;
	vk?.addEventListener?.("geometrychange", scheduleUpdate);
	if (typeof window !== "undefined") {
		window.addEventListener("resize", scheduleUpdate);
		window.addEventListener("keyboardWillShow", scheduleUpdate);
		window.addEventListener("keyboardWillHide", scheduleUpdate);
		window.addEventListener("keyboardDidShow", scheduleUpdate);
		window.addEventListener("keyboardDidHide", scheduleUpdate);
	}

	// Obsidian 모바일(Capacitor)이 document.documentElement.style의 --keyboard-height를 변경할 때 즉시 감지
	let rootStyleObserver: MutationObserver | null = null;
	if (typeof MutationObserver !== "undefined" && typeof document !== "undefined" && document.documentElement) {
		rootStyleObserver = new MutationObserver(() => {
			scheduleUpdate();
		});
		rootStyleObserver.observe(document.documentElement, {
			attributes: true,
			attributeFilter: ["style"],
		});
	}

	return {
		update: () => {
			measureAndApply();
			scheduleUpdate();
		},
		destroy: () => {
			rootStyleObserver?.disconnect();
			rootStyleObserver = null;
			if (vv) {
				vv.removeEventListener("resize", scheduleUpdate);
				vv.removeEventListener("scroll", scheduleUpdate);
			}
			vk?.removeEventListener?.("geometrychange", scheduleUpdate);
			if (typeof window !== "undefined") {
				window.removeEventListener("resize", scheduleUpdate);
				window.removeEventListener("keyboardWillShow", scheduleUpdate);
				window.removeEventListener("keyboardWillHide", scheduleUpdate);
				window.removeEventListener("keyboardDidShow", scheduleUpdate);
				window.removeEventListener("keyboardDidHide", scheduleUpdate);
				if (rafId !== null) {
					window.cancelAnimationFrame(rafId);
					rafId = null;
				}
				if (settleTimerId !== null) {
					window.clearTimeout(settleTimerId);
					settleTimerId = null;
				}
				if (lateSettleTimerId !== null) {
					window.clearTimeout(lateSettleTimerId);
					lateSettleTimerId = null;
				}
			}
			const containerEl = options.getContainerEl();
			if (containerEl) {
				applyOffset(containerEl, 0, false);
			}
		},
	};
}
