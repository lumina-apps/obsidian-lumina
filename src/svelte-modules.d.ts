// Allow importing .svelte.ts files (Svelte 5 Runes modules)
declare module "*.svelte.ts";

// Allow importing .svelte files
declare module "*.svelte" {
	import type { Component } from "svelte";
	const component: Component;
	export default component;
}

// 개발 빌드 전용 Pro 기능 활성화 컴파일 타임 플래그 (프로덕션 빌드에서는 항상 false)
declare const __LUMINA_DEV_PRO__: boolean;
