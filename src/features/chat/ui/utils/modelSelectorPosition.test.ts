import { describe, it, expect } from "vitest";
import { computeDesktopModelDropdownStyle } from "./modelSelectorPosition";

describe("computeDesktopModelDropdownStyle", () => {
	it("우측 사이드바(400px)에서 우측 정렬 드롭다운이 좌측으로 넘치지 않도록 호스트 좌측 여백에 클램핑한다", () => {
		// 사이드바(400px)가 뷰포트 x=800~1200에 위치, 모델 선택 트리거가 x=916~1056에 위치
		const style = computeDesktopModelDropdownStyle({
			triggerRect: { left: 916, right: 1056, width: 140 },
			hostRect: { left: 800, right: 1200, width: 400 },
			dropdownAlign: "right",
		});

		// host 기준 relLeft=116, relRight=256, rawLeft=-104 → clampedLeft=8 → offsetLeft=8-116=-108
		expect(style).toBe("left: -108px; right: auto; width: 360px; max-width: 384px;");
	});

	it("좁은 사이드바(320px)에서는 드롭다운 너비를 호스트 가용 폭으로 축소하고 양쪽 여백을 유지한다", () => {
		const style = computeDesktopModelDropdownStyle({
			triggerRect: { left: 950, right: 1050, width: 100 },
			hostRect: { left: 880, right: 1200, width: 320 },
			dropdownAlign: "right",
		});

		// availableWidth=304, dropdownWidth=304, relLeft=70, clampedLeft=8 → offsetLeft=-62
		expect(style).toBe("left: -62px; right: auto; width: 304px; max-width: 304px;");
	});

	it("넓은 채팅 패널(700px)에서는 우측 정렬 기준을 유지한다", () => {
		const style = computeDesktopModelDropdownStyle({
			triggerRect: { left: 416, right: 556, width: 140 },
			hostRect: { left: 0, right: 700, width: 700 },
			dropdownAlign: "right",
		});

		// relLeft=416, relRight=556, rawLeft=196 (범위 8~332 내) → offsetLeft=196-416=-220
		expect(style).toBe("left: -220px; right: auto; width: 360px; max-width: 684px;");
	});

	it("좌측 정렬 드롭다운이 우측 경계를 넘지 않도록 클램핑한다", () => {
		const style = computeDesktopModelDropdownStyle({
			triggerRect: { left: 300, right: 440, width: 140 },
			hostRect: { left: 0, right: 500, width: 500 },
			dropdownAlign: "left",
		});

		// relLeft=300, maxLeft=500-8-360=132 → clampedLeft=132 → offsetLeft=132-300=-168
		expect(style).toBe("left: -168px; right: auto; width: 360px; max-width: 484px;");
	});

	it("좌측 정렬 드롭다운이 호스트 내부에 여유가 있으면 트리거 좌측에 맞춘다", () => {
		const style = computeDesktopModelDropdownStyle({
			triggerRect: { left: 40, right: 180, width: 140 },
			hostRect: { left: 0, right: 900, width: 900 },
			dropdownAlign: "left",
		});

		// relLeft=40, clampedLeft=40 → offsetLeft=0
		expect(style).toBe("left: 0px; right: auto; width: 360px; max-width: 884px;");
	});

	it("호스트 영역이 없거나 폭이 0이면 undefined를 반환해 기본 CSS로 폴백한다", () => {
		expect(
			computeDesktopModelDropdownStyle({
				triggerRect: { left: 100, right: 240, width: 140 },
				hostRect: null,
				dropdownAlign: "right",
			}),
		).toBeUndefined();

		expect(
			computeDesktopModelDropdownStyle({
				triggerRect: { left: 100, right: 240, width: 140 },
				hostRect: { left: 0, right: 0, width: 0 },
				dropdownAlign: "right",
			}),
		).toBeUndefined();
	});
});
