/**
 * projectStore.ts
 *
 * 활성 프로젝트 전역 상태.
 * plugin.settings.projects의 반응형 복사본.
 *
 * - 단방향: plugin.settings → store
 * - syncProjectStore() 를 saveSettings() 이후 호출하여 동기화
 */

import { writable, derived, get } from 'svelte/store';
import type { ProjectConfig } from '../../shared/types/project.types';
import { DEFAULT_PROJECT_ID } from '../../shared/types/project.types';

// ─── State ────────────────────────────────────────────────────────────────────

/** 프로젝트 목록 */
export const projectList = writable<ProjectConfig[]>([]);

/** 현재 활성 프로젝트 ID */
export const activeProjectId = writable<string>(DEFAULT_PROJECT_ID);

/** 현재 활성 ProjectConfig (derived) */
export const activeProject = derived(
	[projectList, activeProjectId],
	([$list, $id]) => $list.find(p => p.id === $id) ?? $list[0],
);

// ─── Init ─────────────────────────────────────────────────────────────────────

/** 플러그인 로드 시 스토어 초기화 */
export function initProjectStore(
	list: ProjectConfig[],
	currentActiveId: string,
): void {
	projectList.set(list);
	activeProjectId.set(currentActiveId);
}

// ─── Actions ──────────────────────────────────────────────────────────────────

/** 설정 저장 후 스토어 동기화 */
export function syncProjectStore(
	list: ProjectConfig[],
	currentActiveId: string,
): void {
	projectList.set([...list.map(p => ({ ...p, ragIncludedPaths: [...p.ragIncludedPaths], ragExcludedPaths: [...p.ragExcludedPaths] }))]);
	activeProjectId.set(currentActiveId);
}

/** 특정 프로젝트로 활성 전환 (store만 업데이트; plugin.settings 저장은 호출부에서) */
export function setActiveProject(id: string): void {
	const list = get(projectList);
	if (list.some(p => p.id === id)) {
		activeProjectId.set(id);
	}
}

/** 현재 활성 ProjectConfig 반환 (동기) */
export function getActiveProject(): ProjectConfig {
	const list = get(projectList);
	const id = get(activeProjectId);
	return list.find(p => p.id === id) ?? list[0];
}
