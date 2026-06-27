/** View 활성화/비활성화 공통 유틸리티 */

import { Workspace } from 'obsidian';

/** 특정 View Type 패널을 오른쪽 사이드바에 열거나 포커스 */
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

/** 특정 View Type 패널을 메인 워크스페이스(가운데 탭)에 열거나 포커스 */
export async function activateMainView(
	workspace: Workspace,
	viewType: string,
): Promise<void> {
	const existing = workspace.getLeavesOfType(viewType);
	if (existing.length > 0) {
		await workspace.revealLeaf(existing[0]);
		return;
	}

	const leaf = workspace.getLeaf('tab');
	await leaf.setViewState({ type: viewType, active: true });
	await workspace.revealLeaf(leaf);
}

/** 특정 View Type의 모든 패널을 닫음 */
export function closeView(workspace: Workspace, viewType: string): void {
	workspace
		.getLeavesOfType(viewType)
		.forEach(leaf => leaf.detach());
}