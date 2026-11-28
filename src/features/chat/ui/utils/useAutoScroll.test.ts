import { readFileSync } from "fs";
import { resolve } from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useAutoScroll } from "./useAutoScroll.svelte";

/** 테스트용 스크롤 컨테이너 목 객체를 생성합니다. */
function createMockScrollEl(initial: {
	scrollTop: number;
	scrollHeight: number;
	clientHeight: number;
}) {
	const state = { ...initial };
	const scrollTo = vi.fn((options?: ScrollToOptions) => {
		if (options && typeof options.top === "number") {
			state.scrollTop = Math.max(0, Math.min(options.top, state.scrollHeight - state.clientHeight));
		}
	});

	return {
		state,
		scrollTo,
		el: {
			get scrollTop() {
				return state.scrollTop;
			},
			set scrollTop(v: number) {
				state.scrollTop = v;
			},
			get scrollHeight() {
				return state.scrollHeight;
			},
			get clientHeight() {
				return state.clientHeight;
			},
			scrollTo,
		} as unknown as HTMLElement,
	};
}

describe("useAutoScroll", () => {
	let rafCallbacks: Array<{ id: number; cb: FrameRequestCallback }>;
	let nextRafId: number;

	beforeEach(() => {
		rafCallbacks = [];
		nextRafId = 1;
		vi.stubGlobal("window", {
			requestAnimationFrame: vi.fn((cb: FrameRequestCallback) => {
				const id = nextRafId++;
				rafCallbacks.push({ id, cb });
				return id;
			}),
			cancelAnimationFrame: vi.fn((id: number) => {
				rafCallbacks = rafCallbacks.filter((item) => item.id !== id);
			}),
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function flushRaf(): void {
		const pending = [...rafCallbacks];
		rafCallbacks = [];
		for (const item of pending) {
			item.cb(performance.now());
		}
	}

	it("scrollToBottom은 기본적으로 instant 동작으로 맨 아래로 이동한다", async () => {
		const mock = createMockScrollEl({ scrollTop: 0, scrollHeight: 1200, clientHeight: 400 });
		const autoScroll = useAutoScroll(() => mock.el);

		await autoScroll.scrollToBottom();

		expect(mock.scrollTo).toHaveBeenCalledWith({ top: 1200, behavior: "instant" });
		expect(mock.state.scrollTop).toBe(800);
	});

	it("scrollToBottom('auto') 호출 시에도 CSS smooth 충돌을 피하기 위해 instant로 변환한다", async () => {
		const mock = createMockScrollEl({ scrollTop: 0, scrollHeight: 1000, clientHeight: 400 });
		const autoScroll = useAutoScroll(() => mock.el);

		await autoScroll.scrollToBottom("auto");

		expect(mock.scrollTo).toHaveBeenCalledWith({ top: 1000, behavior: "instant" });
	});

	it("사용자가 위로 스크롤하면 isUserScrolledUp이 true가 되고, 하단 복귀 시 false가 된다", async () => {
		const mock = createMockScrollEl({ scrollTop: 0, scrollHeight: 1200, clientHeight: 400 });
		const autoScroll = useAutoScroll(() => mock.el);

		await autoScroll.scrollToBottom("instant");
		expect(autoScroll.isUserScrolledUp).toBe(false);

		// 사용자가 위로 스크롤 (바닥에서 200px 위)
		mock.state.scrollTop = 600;
		autoScroll.handleScroll();
		flushRaf();
		expect(autoScroll.isUserScrolledUp).toBe(true);

		// 바닥 근처(40px 이내)로 복귀
		mock.state.scrollTop = 770;
		autoScroll.handleScroll();
		flushRaf();
		expect(autoScroll.isUserScrolledUp).toBe(false);
	});

	it("destroy 호출 시 예약된 rAF를 취소한다", () => {
		const mock = createMockScrollEl({ scrollTop: 100, scrollHeight: 1200, clientHeight: 400 });
		const autoScroll = useAutoScroll(() => mock.el);

		autoScroll.handleScroll();
		expect(rafCallbacks.length).toBe(1);

		autoScroll.destroy();
		expect(rafCallbacks.length).toBe(0);
	});

	it("채팅 메시지 컨테이너 CSS는 컴포지터 스크롤 고착을 유발하는 scroll-behavior: smooth 없이 min-height: 0과 overflow-anchor: none을 가진다", () => {
		const cssPath = resolve(process.cwd(), "styles.css");
		const css = readFileSync(cssPath, "utf8");
		const match = css.match(/\.lumina-chat__messages\s*\{([^}]*)\}/);

		expect(match).not.toBeNull();
		const block = match![1];
		expect(block).toContain("min-height: 0;");
		expect(block).toContain("overflow-y: auto;");
		expect(block).toContain("overflow-anchor: none;");
		expect(block).not.toContain("scroll-behavior: smooth");
	});
});
