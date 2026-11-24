import { derived, get, writable, type Readable } from 'svelte/store';
import type { EntitlementState, ProFeatureId } from '../../shared/types/entitlement.types';

/** 전체 Pro 기능 식별자 목록 */
const ALL_PRO_FEATURES: readonly ProFeatureId[] = ['split-chat', 'batch-studio', 'voice-note'];

/**
 * 프로덕션 빌드에서 무료(Freemium)로 기본 노출할 기능 목록.
 * 정식 출시 전까지는 빈 배열을 유지하여 UI·커맨드에서 완전히 숨겨둡니다.
 */
const PRODUCTION_RELEASED_FEATURES: readonly ProFeatureId[] = [];

/** 무료 티어 모델 비교 최대 슬롯 수 */
export const FREE_MAX_SPLIT_SLOTS = 2;
/** Pro 티어 모델 비교 최대 슬롯 수 */
export const PRO_MAX_SPLIT_SLOTS = 4;
/** 무료 티어 배치 작업 1회 최대 처리 노트 수 */
export const FREE_MAX_BATCH_FILES = 5;
/** 무료 티어 Voice-to-Note 1회 최대 오디오 길이(초, 5분) */
export const FREE_MAX_VOICE_DURATION_SEC = 300;

/** 기본 무료(미인증) 권한 상태 */
export const FREE_ENTITLEMENT: EntitlementState = {
	tier: 'free',
	status: 'inactive',
	enabledFeatures: new Set<ProFeatureId>(),
	releasedFeatures: new Set<ProFeatureId>(PRODUCTION_RELEASED_FEATURES),
	expiresAt: null,
	verifiedAt: null,
};

/** 전역 Pro 권한 상태 스토어 */
export const entitlementStore = writable<EntitlementState>({
	...FREE_ENTITLEMENT,
	enabledFeatures: new Set<ProFeatureId>(),
	releasedFeatures: new Set<ProFeatureId>(PRODUCTION_RELEASED_FEATURES),
});

/** Pro 라이선스 활성 여부를 구독하는 파생 스토어 */
export const isProActive: Readable<boolean> = derived(
	entitlementStore,
	($e) => $e.tier === 'pro' && $e.status === 'active',
);

function isProFeatureUnlockedInState(state: EntitlementState, feature: ProFeatureId): boolean {
	return (
		state.tier === 'pro' &&
		state.status === 'active' &&
		state.enabledFeatures.has(feature)
	);
}

function isFeatureAccessibleInState(state: EntitlementState, feature: ProFeatureId): boolean {
	return Boolean(state.releasedFeatures?.has(feature)) || isProFeatureUnlockedInState(state, feature);
}

/**
 * 특정 기능의 Pro 유료 등급(무제한/고급 옵션) 활성화 여부를 반응형으로 구독합니다.
 */
export function hasProFeature(feature: ProFeatureId): Readable<boolean> {
	return derived(
		entitlementStore,
		($e) => isProFeatureUnlockedInState($e, feature),
	);
}

/**
 * 특정 기능의 Pro 유료 등급 활성화 여부를 동기적으로 판별합니다.
 */
export function canUseProFeature(feature: ProFeatureId): boolean {
	return isProFeatureUnlockedInState(get(entitlementStore), feature);
}

/**
 * 특정 기능 진입점(무료 제한 체험 또는 Pro 전체)에 접근 가능한지 반응형으로 구독합니다.
 */
export function hasFeatureAccess(feature: ProFeatureId): Readable<boolean> {
	return derived(
		entitlementStore,
		($e) => isFeatureAccessibleInState($e, feature),
	);
}

/**
 * 특정 기능(무료 제한 체험 또는 Pro 전체)을 사용할 수 있는지 동기적으로 판별합니다.
 */
export function canUseFeature(feature: ProFeatureId): boolean {
	return isFeatureAccessibleInState(get(entitlementStore), feature);
}

/**
 * 무료(Freemium) 모드로 노출할 기능 집합을 런타임에 설정합니다.
 */
export function setReleasedFeatures(features: Iterable<ProFeatureId>): void {
	entitlementStore.update((current) => ({
		...current,
		releasedFeatures: new Set<ProFeatureId>(features),
	}));
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
		releasedFeatures: new Set<ProFeatureId>(
			next.releasedFeatures ?? PRODUCTION_RELEASED_FEATURES,
		),
		expiresAt: next.expiresAt ?? null,
		verifiedAt: next.verifiedAt ?? null,
	});
}

/**
 * 권한 상태를 기본 무료(미출시 은닉) 상태로 초기화합니다.
 */
export function resetEntitlementState(): void {
	entitlementStore.set({
		...FREE_ENTITLEMENT,
		enabledFeatures: new Set<ProFeatureId>(),
		releasedFeatures: new Set<ProFeatureId>(PRODUCTION_RELEASED_FEATURES),
	});
}

/**
 * 플러그인 시작 시 권한 스토어를 초기화합니다.
 * 프로덕션 빌드에서는 __LUMINA_DEV_PRO__와 __LUMINA_DEV_PREVIEW__가 모두 false로 치환됩니다.
 */
export function initEntitlementStore(): void {
	if (typeof __LUMINA_DEV_PRO__ !== 'undefined' && __LUMINA_DEV_PRO__) {
		setEntitlementState({
			tier: 'pro',
			status: 'active',
			enabledFeatures: new Set<ProFeatureId>(ALL_PRO_FEATURES),
			releasedFeatures: new Set<ProFeatureId>(ALL_PRO_FEATURES),
			expiresAt: null,
			verifiedAt: Date.now(),
		});
		return;
	}
	resetEntitlementState();
	if (typeof __LUMINA_DEV_PREVIEW__ !== 'undefined' && __LUMINA_DEV_PREVIEW__) {
		setReleasedFeatures(ALL_PRO_FEATURES);
	}
}
