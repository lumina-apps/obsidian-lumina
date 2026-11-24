import { Platform, type App, type PaneType, type Workspace, type WorkspaceLeaf } from 'obsidian';
import {
	BATCH_STUDIO_VIEW_TYPE,
	GRAPH_VIEW_TYPE,
	SPLIT_CHAT_VIEW_TYPE,
} from '../constants/viewTypes';

/** 현재 화면이 노트로 덮어써지면 안 되는 Lumina 메인 워크스페이스 커스텀 뷰 타입 */
export const PROTECTED_MAIN_VIEW_TYPES = new Set<string>([
	SPLIT_CHAT_VIEW_TYPE,
	GRAPH_VIEW_TYPE,
	BATCH_STUDIO_VIEW_TYPE,
]);

/**
 * 현재 활성 리프가 SplitChat·Graph·BatchStudio 같은 Lumina 커스텀 뷰인 경우
 * 일반 클릭(requestedNewLeaf === false) 시 현재 뷰가 노트로 덮어써지지 않도록 'tab'을 반환합니다.
 */
export function resolveSafeLeafTarget(
	workspace: Workspace,
	requestedNewLeaf: PaneType | boolean,
): PaneType | boolean {
	if (requestedNewLeaf !== false) {
		return requestedNewLeaf;
	}

	const activeLeaf = (workspace as unknown as { activeLeaf?: WorkspaceLeaf | null }).activeLeaf;
	const activeViewType = activeLeaf?.view?.getViewType?.();
	if (activeViewType && PROTECTED_MAIN_VIEW_TYPES.has(activeViewType)) {
		return 'tab';
	}

	const recentLeaf = typeof workspace.getMostRecentLeaf === 'function'
		? workspace.getMostRecentLeaf()
		: null;
	const recentViewType = recentLeaf?.view?.getViewType?.();
	if (recentViewType && PROTECTED_MAIN_VIEW_TYPES.has(recentViewType)) {
		return 'tab';
	}

	return requestedNewLeaf;
}

/**
 * 모바일(스마트폰·태블릿) 환경에서 사이드바 오버레이 드로어를 닫고 대상 리프를 화면 전면에 표시합니다.
 */
export async function revealLeafOnMobile(
	workspace: Workspace,
	leaf: WorkspaceLeaf | null | undefined,
): Promise<void> {
	if (
		typeof Platform !== 'undefined' &&
		Platform?.isMobile &&
		leaf &&
		typeof workspace.revealLeaf === 'function'
	) {
		await workspace.revealLeaf(leaf);
	}
}

/**
 * 커스텀 메인 뷰 덮어쓰기 방지 및 모바일 드로어 숨김(revealLeaf) 처리를 포함해 링크를 안전하게 엽니다.
 */
export async function openLinkTextSafely(
	app: App,
	linktext: string,
	sourcePath: string,
	requestedNewLeaf: PaneType | boolean,
): Promise<void> {
	const target = resolveSafeLeafTarget(app.workspace, requestedNewLeaf);
	await app.workspace.openLinkText(linktext, sourcePath, target);
	if (typeof Platform !== 'undefined' && Platform?.isMobile) {
		const activeLeaf = (app.workspace as unknown as { activeLeaf?: WorkspaceLeaf | null }).activeLeaf;
		await revealLeafOnMobile(app.workspace, activeLeaf);
	}
}
