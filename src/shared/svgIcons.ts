/**
 * svgIcons.ts
 *
 * UI 컴포넌트에서 공통 사용하는 SVG 아이콘의 내부 path를 상수로 관리합니다.
 * 24x24 viewBox 기준이며, wrapper <svg> 태그 없이 내부 요소만 정의합니다.
 */

export const SVG_BACK_ARROW = `<line x1="19" y1="12" x2="5" y2="12"></line><polyline points="12 19 5 12 12 5"></polyline>`;

export const SVG_REFRESH = `<polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>`;

export const SVG_TRASH = `<polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>`;