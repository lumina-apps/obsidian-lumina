/**
 * viewHelper.ts
 *
 * View 활성화/비활성화 공통 유틸리티.
 * main.ts에서 activateChatView/activateDebugView의 중복 패턴을 통합합니다.
 */

import { Workspace } from 'obsidian';

/**
 * 특정 View Type의 패널을 오른쪽 사이드바에 열거나 포커스합니다.
 * 이미 열려 있으면 포커스만, 없으면 새 탭으로 엽니다.
 *
 * @param workspace Obsidian Workspace 인스턴스
 * @param viewType 등록된 View Type 문자열
 * @returns 열린/포커스된 leaf, 불가능하면 null
 */
export async function activateView(
	workspace: Workspace,
	viewType: string,
): Promise<void> {
	const existing = workspace.getLeavesOfType(viewType);
	if (existing.length > 0) {
		await workspace.revealLeaf(existing[0]);
		return;
	}

	const leaf = workspace.getRightLeaf(false);
	if (!leaf) return;
	await leaf.setViewState({ type: viewType, active: true });
	await workspace.revealLeaf(leaf);
}

/**
 * 특정 View Type의 모든 패널을 닫습니다.
 *
 * @param workspace Obsidian Workspace 인스턴스
 * @param viewType 등록된 View Type 문자열
 */
export function closeView(workspace: Workspace, viewType: string): void {
	workspace
		.getLeavesOfType(viewType)
		.forEach(leaf => leaf.detach());
}