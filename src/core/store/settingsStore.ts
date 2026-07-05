/**
 * settingsStore.ts
 *
 * plugin.settings의 반응형 복사본.
 * - 단방향: plugin.settings → store (스토어가 원본을 덮어쓰지 않음)
 * - plugin.saveSettings() 이후 syncSettingsStore() 호출로 동기화
 *
 * Svelte 컴포넌트에서 $settingsStore 구독 시 설정 변경에 반응형으로 동작.
 * plugin 인스턴스에 접근할 수 없는 컴포넌트에서도 설정 읽기 가능.
 */

import { writable, derived } from 'svelte/store';
import type { LuminaSettings } from '../settings/settings.types';

// ─── State ────────────────────────────────────────────────────────────────────

/** 플러그인 초기화 전: null, 초기화 후: LuminaSettings */
export const settingsStore = writable<LuminaSettings | null>(null);

// ─── Derived ──────────────────────────────────────────────────────────────────

/** 연결 설정이 존재하는지 여부 */
export const hasAnyProvider = derived(
	settingsStore,
	($s) => ($s?.connections.providers.filter(p => p.isVerified).length ?? 0) > 0,
);

/** 검증된 프로바이더 목록 */
export const verifiedProviders = derived(settingsStore, ($s) =>
	$s?.connections.providers.filter(p => p.isVerified && p.availableModels.length > 0) ?? [],
);

/** RAG 활성화 여부 */
export const isRagEnabled = derived(
	settingsStore,
	($s) => $s?.connections.ragEnabled ?? false,
);

// ─── Init ─────────────────────────────────────────────────────────────────────

/** 플러그인 로드 시 스토어 초기화 (한 번만 호출) */
export function initSettingsStore(settings: LuminaSettings): void {
	settingsStore.set(settings);
}

// ─── Actions ──────────────────────────────────────────────────────────────────

/**
 * 설정 저장 후 스토어 동기화.
 * plugin.saveSettings() 이후 반드시 호출.
 *
 * 각 섹션을 구조 분해하여 새 객체 참조를 전달하므로
 * Svelte 5의 $derived / $effect 가 정상적으로 반응함.
 *
 * @example
 * await this.plugin.saveSettings();
 * syncSettingsStore(this.plugin.settings);
 */
export function syncSettingsStore(settings: LuminaSettings): void {
	settingsStore.set({
		connections: { ...settings.connections, providers: [...settings.connections.providers], embedding: { ...settings.connections.embedding } },
		chat: { ...settings.chat, quickActions: [...settings.chat.quickActions] },
		rag: { ...settings.rag },
		misc: { ...settings.misc },
		mcp: { ...settings.mcp, servers: [...settings.mcp.servers] },
		webSearch: { ...settings.webSearch, providers: [...settings.webSearch.providers] },
		canvas: { ...settings.canvas },
		projects: { ...settings.projects, list: [...settings.projects.list.map(p => ({ ...p }))] },
	});
}
