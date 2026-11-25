import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Platform } from "obsidian";
import {
	calculateKeyboardOverlapPx,
	setupMobileKeyboardViewport,
} from "./useMobileKeyboardViewport";

describe("useMobileKeyboardViewport", () => {
	const origIsMobile = Platform.isMobile;
	const origVisualViewport = window.visualViewport;
	const origInnerHeight = window.innerHeight;

	let listeners: Record<string, Set<EventListener>>;
	let mockViewport: {
		height: number;
		offsetTop: number;
		addEventListener: ReturnType<typeof vi.fn>;
		removeEventListener: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		(Platform as { isMobile: boolean }).isMobile = true;
		document.body.classList.add("is-mobile");
		listeners = {
			resize: new Set(),
			scroll: new Set(),
		};
		mockViewport = {
			height: 800,
			offsetTop: 0,
			addEventListener: vi.fn((type: string, cb: EventListener) => {
				listeners[type]?.add(cb);
			}),
			removeEventListener: vi.fn((type: string, cb: EventListener) => {
				listeners[type]?.delete(cb);
			}),
		};
		Object.defineProperty(window, "visualViewport", {
			configurable: true,
			writable: true,
			value: mockViewport,
		});
		Object.defineProperty(window, "innerHeight", {
			configurable: true,
			writable: true,
			value: 800,
		});
	});

	afterEach(() => {
		(Platform as { isMobile: boolean }).isMobile = origIsMobile;
		document.body.classList.remove("is-mobile");
		document.documentElement.style.removeProperty("--keyboard-height");
		Object.defineProperty(window, "visualViewport", {
			configurable: true,
			writable: true,
			value: origVisualViewport,
		});
		Object.defineProperty(window, "innerHeight", {
			configurable: true,
			writable: true,
			value: origInnerHeight,
		});
	});

	it("calculateKeyboardOverlapPx는 컨테이너 하단이 visualViewport 하단 또는 Obsidian --keyboard-height 상단보다 아래에 있을 때 가려진 높이를 반환한다", () => {
		expect(calculateKeyboardOverlapPx(800, 500, 0)).toBe(300);
		expect(calculateKeyboardOverlapPx(800, 500, 20)).toBe(280);
		// 이미 컨테이너가 키보드 위로 올라와 있는 경우 0 반환
		expect(calculateKeyboardOverlapPx(500, 500, 0)).toBe(0);
		expect(calculateKeyboardOverlapPx(480, 500, 0)).toBe(0);
		// Android/iOS Obsidian에서 visualViewport는 800 그대로이고 --keyboard-height만 320px로 주입된 경우 (.workspace-drawer)
		expect(calculateKeyboardOverlapPx(800, 800, 0, 320, 800)).toBe(320);
		// .mod-root(.app-container)처럼 이미 max-height: calc(100vh - var(--keyboard-height))로 줄어든 경우(rect.bottom=480) 이중 여백 방지(0 반환)
		expect(calculateKeyboardOverlapPx(480, 800, 0, 320, 800)).toBe(0);
	});

	it("Obsidian 모바일이 visualViewport 크기를 유지한 채 :root에 --keyboard-height를 설정하고 keyboardWillShow를 발생시킬 때 오프셋을 적용한다", () => {
		const container = document.createElement("div");
		const textarea = document.createElement("textarea");
		container.appendChild(textarea);
		document.body.appendChild(container);

		vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
			bottom: 800,
			top: 720,
			left: 0,
			right: 390,
			width: 390,
			height: 80,
			x: 0,
			y: 720,
			toJSON: () => ({}),
		});

		const onKeyboardOpen = vi.fn();
		const ctrl = setupMobileKeyboardViewport({
			getContainerEl: () => container,
			getInputEl: () => textarea,
			onKeyboardOpen,
		});

		textarea.focus();
		// visualViewport.height는 800 그대로이나 Obsidian Capacitor 브리지가 --keyboard-height: 315px 주입
		document.documentElement.style.setProperty("--keyboard-height", "315px");
		window.dispatchEvent(new Event("keyboardWillShow"));
		ctrl.update();

		expect(container.style.getPropertyValue("--lumina-keyboard-offset")).toBe("315px");
		expect(container.classList.contains("is-keyboard-open")).toBe(true);
		expect(onKeyboardOpen).toHaveBeenCalledWith(315);

		document.documentElement.style.setProperty("--keyboard-height", "0px");
		window.dispatchEvent(new Event("keyboardWillHide"));
		textarea.blur();
		ctrl.update();

		expect(container.style.getPropertyValue("--lumina-keyboard-offset")).toBe("0px");
		expect(container.classList.contains("is-keyboard-open")).toBe(false);

		ctrl.destroy();
		container.remove();
	});

	it("우측 사이드바 하단 메뉴/문서상태 2줄만큼 입력창이 이미 위에 있을 때(rect.bottom < innerHeight) 그 높이를 뺀 실제 침범 높이만 오프셋으로 적용해 빈 공간을 방지한다", () => {
		const container = document.createElement("div");
		const textarea = document.createElement("textarea");
		container.appendChild(textarea);
		document.body.appendChild(container);

		// 화면 전체 높이는 800px이지만 하단 2줄(탭 선택바 + 문서 상태바 90px) 때문에 입력창 하단은 710px에 위치
		vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
			bottom: 710,
			top: 630,
			left: 0,
			right: 390,
			width: 390,
			height: 80,
			x: 0,
			y: 630,
			toJSON: () => ({}),
		});

		const ctrl = setupMobileKeyboardViewport({
			getContainerEl: () => container,
			getInputEl: () => textarea,
		});

		textarea.focus();
		// 가상 키보드 높이 315px (키보드 상단 y = 800 - 315 = 485px)
		// 입력창 하단(710px)에서 키보드 상단(485px)까지 실제 겹치는 높이는 315 - 90 = 225px
		document.documentElement.style.setProperty("--keyboard-height", "315px");
		ctrl.update();

		expect(container.style.getPropertyValue("--lumina-keyboard-offset")).toBe("225px");
		expect(container.classList.contains("is-keyboard-open")).toBe(true);

		ctrl.destroy();
		container.remove();
	});

	it("가상 키보드가 올라와 입력창 하단을 가릴 때 --lumina-keyboard-offset과 is-keyboard-open 클래스를 설정한다", () => {
		const container = document.createElement("div");
		const textarea = document.createElement("textarea");
		container.appendChild(textarea);
		document.body.appendChild(container);

		vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
			bottom: 800,
			top: 720,
			left: 0,
			right: 390,
			width: 390,
			height: 80,
			x: 0,
			y: 720,
			toJSON: () => ({}),
		});

		const onKeyboardOpen = vi.fn();
		const ctrl = setupMobileKeyboardViewport({
			getContainerEl: () => container,
			getInputEl: () => textarea,
			onKeyboardOpen,
		});

		textarea.focus();
		// 가상 키보드가 310px 높이로 올라와 visualViewport.height가 490px로 줄어든 상황
		mockViewport.height = 490;
		ctrl.update();

		expect(container.style.getPropertyValue("--lumina-keyboard-offset")).toBe("310px");
		expect(container.classList.contains("is-keyboard-open")).toBe(true);
		expect(onKeyboardOpen).toHaveBeenCalledWith(310);

		// 가상 키보드가 내려간 상황
		mockViewport.height = 800;
		textarea.blur();
		ctrl.update();

		expect(container.style.getPropertyValue("--lumina-keyboard-offset")).toBe("0px");
		expect(container.classList.contains("is-keyboard-open")).toBe(false);

		ctrl.destroy();
		container.remove();
	});

	it("데스크탑 환경에서는 오프셋을 적용하지 않고 0px을 유지한다", () => {
		(Platform as { isMobile: boolean }).isMobile = false;
		document.body.classList.remove("is-mobile");

		const container = document.createElement("div");
		const textarea = document.createElement("textarea");
		container.appendChild(textarea);
		document.body.appendChild(container);

		vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
			bottom: 800,
			top: 720,
			left: 0,
			right: 390,
			width: 390,
			height: 80,
			x: 0,
			y: 720,
			toJSON: () => ({}),
		});

		const ctrl = setupMobileKeyboardViewport({
			getContainerEl: () => container,
			getInputEl: () => textarea,
		});

		textarea.focus();
		mockViewport.height = 480;
		ctrl.update();

		expect(container.classList.contains("is-keyboard-open")).toBe(false);

		ctrl.destroy();
		container.remove();
	});
});
