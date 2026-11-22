import { derived, get, writable, type Readable } from 'svelte/store';
import type { EntitlementState, ProFeatureId } from '../../shared/types/entitlement.types';

/** 기본 무료(미인증) 권한 상태 */
export const FREE_ENTITLEMENT: EntitlementState = {
	tier: 'free',
	status: 'inactive',
	enabledFeatures: new Set<ProFeatureId>(),
	expiresAt: null,
	verifiedAt: null,
};

/** 전역 Pro 권한 상태 스토어 */
export const entitlementStore = writable<EntitlementState>({
	...FREE_ENTITLEMENT,
	enabledFeatures: new Set<ProFeatureId>(),
});

/** Pro 라이선스 활성 여부를 구독하는 파생 스토어 */
export const isProActive: Readable<boolean> = derived(
	entitlementStore,
	($e) => $e.tier === 'pro' && $e.status === 'active',
);

/**
 * 특정 Pro 기능의 활성화 여부를 반응형으로 구독합니다.
 */
export function hasProFeature(feature: ProFeatureId): Readable<boolean> {
	return derived(
		entitlementStore,
		($e) => $e.tier === 'pro' && $e.status === 'active' && $e.enabledFeatures.has(feature),
	);
}

/**
 * 특정 Pro 기능을 사용할 수 있는지 동기적으로 판별합니다.
 */
export function canUseFeature(feature: ProFeatureId): boolean {
	const current = get(entitlementStore);
	return (
		current.tier === 'pro' &&
		current.status === 'active' &&
		current.enabledFeatures.has(feature)
	);
}

/**
 * 런타임 권한 상태를 갱신합니다.
 * 추후 Lemon Squeezy 라이선스 검증 모듈에서 유일하게 호출하는 연동 지점입니다.
 */
export function setEntitlementState(next: EntitlementState): void {
	entitlementStore.set({
		tier: next.tier,
		status: next.status,
		enabledFeatures: new Set<ProFeatureId>(next.enabledFeatures),
		expiresAt: next.expiresAt ?? null,
		verifiedAt: next.verifiedAt ?? null,
	});
}

/**
 * 권한 상태를 기본 무료(잠금) 상태로 초기화합니다.
 */
export function resetEntitlementState(): void {
	entitlementStore.set({
		...FREE_ENTITLEMENT,
		enabledFeatures: new Set<ProFeatureId>(),
	});
}

/**
 * 플러그인 시작 시 권한 스토어를 초기화합니다.
 * 프로덕션 빌드에서는 __LUMINA_DEV_PRO__가 항상 false로 치환되어 잠금 상태를 유지합니다.
 */
export function initEntitlementStore(): void {
	if (typeof __LUMINA_DEV_PRO__ !== 'undefined' && __LUMINA_DEV_PRO__) {
		setEntitlementState({
			tier: 'pro',
			status: 'active',
			enabledFeatures: new Set<ProFeatureId>(['split-chat', 'batch-studio']),
			expiresAt: null,
			verifiedAt: Date.now(),
		});
		return;
	}
	resetEntitlementState();
}
