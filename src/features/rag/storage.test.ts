import { describe, it, expect, vi, afterEach } from 'vitest';
import { Platform, type App } from 'obsidian';

describe('rag/storage mobile & fallback behavior', () => {
	const origIsDesktop = Platform.isDesktop;
	const origIsMobile = Platform.isMobile;

	afterEach(() => {
		(Platform as { isDesktop: boolean }).isDesktop = origIsDesktop;
		(Platform as { isMobile: boolean }).isMobile = origIsMobile;
		vi.resetModules();
		vi.restoreAllMocks();
	});

	it('모바일 환경에서 모듈 로드 시 path require를 호출하지 않고 getVaultId를 안전하게 계산한다', async () => {
		const winObj = window as unknown as { require?: (mod: string) => unknown };
		const origRequire = winObj.require;
		const requireSpy = vi.fn(() => {
			throw new Error('path module should not be required on mobile');
		});
		winObj.require = requireSpy;

		try {
			(Platform as { isDesktop: boolean }).isDesktop = false;
			(Platform as { isMobile: boolean }).isMobile = true;
			vi.resetModules();

			const { getVaultId } = await import('./storage');
			expect(requireSpy).not.toHaveBeenCalled();

			// 1) app.appId 우선 사용 (특수문자 정제 포함)
			const appWithId = {
				appId: 'vault/123:mobile',
				vault: { adapter: {}, getName: () => 'MobileVault' },
			} as unknown as App;
			expect(getVaultId(appWithId)).toBe('vault_123_mobile');

			// 2) FileSystemAdapter가 없는 CapacitorAdapter 환경 → vault.getName 해시 폴백
			const capacitorApp = {
				vault: {
					adapter: {}, // getBasePath 없음
					getName: () => 'Synced Mobile Vault',
				},
			} as unknown as App;
			const idFromName = getVaultId(capacitorApp);
			expect(idFromName).toBeTruthy();
			expect(idFromName).not.toBe('default-vault');

			// 3) getName도 비어 있을 때 기본 ID 반환
			const bareApp = {
				vault: { adapter: {}, getName: () => '   ' },
			} as unknown as App;
			expect(getVaultId(bareApp)).toBe('default-vault');
		} finally {
			winObj.require = origRequire;
		}
	});
});
