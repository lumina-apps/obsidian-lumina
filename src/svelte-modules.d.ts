// Allow importing .svelte.ts files (Svelte 5 Runes modules)
declare module "*.svelte.ts";

// Allow importing .svelte files
declare module "*.svelte" {
	import type { Component } from "svelte";
	const component: Component;
	export default component;
}
