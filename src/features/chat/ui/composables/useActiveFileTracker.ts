import { onMount } from "svelte";
import type { TAbstractFile } from "obsidian";
import type LuminaPlugin from "../../../../main";

export interface ActiveFileInfo {
	path: string;
	size: number;
}

/**
 * 실시간 토큰 추정 및 컨텍스트용 활성 파일 상태를 추적하는 Composable
 * Svelte 5 컴포넌트 내부에서 반응형 상태($state)를 가질 수 있도록 콜백을 통해 통지합니다.
 */
export function useActiveFileTracker(
	getPlugin: () => LuminaPlugin,
	onUpdate: (info: ActiveFileInfo | null) => void,
) {
	function getInitialActiveFile(): ActiveFileInfo | null {
		const plugin = getPlugin();
		const file = plugin.app.workspace?.getActiveFile?.() ?? plugin.app.workspace?.activeEditor?.file ?? null;
		if (file && "stat" in file && typeof file.stat.size === "number") {
			return { path: file.path, size: file.stat.size };
		}
		return null;
	}

	let currentInfo: ActiveFileInfo | null = getInitialActiveFile();

	function updateActiveFile(): void {
		const plugin = getPlugin();
		const file = plugin.app.workspace?.getActiveFile?.() ?? plugin.app.workspace?.activeEditor?.file ?? null;
		if (file && "stat" in file && typeof file.stat.size === "number") {
			currentInfo = { path: file.path, size: file.stat.size };
		} else {
			currentInfo = null;
		}
		onUpdate(currentInfo);
	}

	onMount(() => {
		const plugin = getPlugin();
		updateActiveFile();
		const refLeaf = plugin.app.workspace?.on?.("active-leaf-change", () => {
			updateActiveFile();
		});
		const refFile = plugin.app.workspace?.on?.("file-open", () => {
			updateActiveFile();
		});
		const refModify = plugin.app.vault?.on?.("modify", (file: TAbstractFile) => {
			if (currentInfo && file?.path === currentInfo.path) {
				updateActiveFile();
			}
		});

		return () => {
			if (refLeaf) plugin.app.workspace?.offref?.(refLeaf);
			if (refFile) plugin.app.workspace?.offref?.(refFile);
			if (refModify) plugin.app.vault?.offref?.(refModify);
		};
	});

	return {
		getInitialActiveFile,
		updateActiveFile,
	};
}
