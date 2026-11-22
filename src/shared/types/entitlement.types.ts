/** Pro 기능 식별자 목록 */
export type ProFeatureId = 'split-chat' | 'batch-studio';

/** 라이선스 티어 */
export type LicenseTier = 'free' | 'pro';

/** 라이선스 인증 상태 */
export type LicenseStatus = 'inactive' | 'active' | 'expired' | 'invalid';

/** 런타임 기능 권한(Entitlement) 상태 */
export interface EntitlementState {
	/** 현재 라이선스 등급 */
	tier: LicenseTier;
	/** 라이선스 검증 상태 */
	status: LicenseStatus;
	/** 활성화된 Pro 기능 집합 */
	enabledFeatures: ReadonlySet<ProFeatureId>;
	/** 만료 시각 (Unix ms, 무기한이거나 미설정 시 null) */
	expiresAt?: number | null;
	/** 마지막 서버 검증 시각 (Unix ms) */
	verifiedAt?: number | null;
}
