import { describe, it, expect, beforeEach } from 'vitest';
import { get } from 'svelte/store';
import {
	entitlementStore,
	isProActive,
	hasProFeature,
	canUseFeature,
	setEntitlementState,
	resetEntitlementState,
	initEntitlementStore,
} from './entitlementStore';

describe('entitlementStore', () => {
	beforeEach(() => {
		resetEntitlementState();
	});

	it('기본 상태는 무료(free/inactive)이며 split-chat이 잠겨 있어야 한다', () => {
		const state = get(entitlementStore);
		expect(state.tier).toBe('free');
		expect(state.status).toBe('inactive');
		expect(state.enabledFeatures.size).toBe(0);
		expect(get(isProActive)).toBe(false);
		expect(canUseFeature('split-chat')).toBe(false);
		expect(get(hasProFeature('split-chat'))).toBe(false);
	});

	it('initEntitlementStore는 테스트/프로덕션 환경에서 기본 잠금 상태로 초기화한다', () => {
		setEntitlementState({
			tier: 'pro',
			status: 'active',
			enabledFeatures: new Set(['split-chat']),
		});
		expect(canUseFeature('split-chat')).toBe(true);

		initEntitlementStore();
		expect(canUseFeature('split-chat')).toBe(false);
		expect(get(isProActive)).toBe(false);
	});

	it('setEntitlementState로 Pro 활성 상태를 주입하면 반응형 및 동기 판별이 모두 true가 된다', () => {
		const featureReadable = hasProFeature('split-chat');
		const observed: boolean[] = [];
		const unsub = featureReadable.subscribe((val) => observed.push(val));

		setEntitlementState({
			tier: 'pro',
			status: 'active',
			enabledFeatures: new Set(['split-chat']),
			expiresAt: 9999999999999,
			verifiedAt: 1700000000000,
		});

		expect(canUseFeature('split-chat')).toBe(true);
		expect(get(isProActive)).toBe(true);
		expect(get(featureReadable)).toBe(true);
		expect(observed).toEqual([false, true]);

		resetEntitlementState();
		expect(canUseFeature('split-chat')).toBe(false);
		expect(get(featureReadable)).toBe(false);
		expect(observed).toEqual([false, true, false]);

		unsub();
	});

	it('tier가 pro여도 status가 expired/invalid면 기능이 잠겨 있어야 한다', () => {
		setEntitlementState({
			tier: 'pro',
			status: 'expired',
			enabledFeatures: new Set(['split-chat']),
		});
		expect(canUseFeature('split-chat')).toBe(false);
		expect(get(isProActive)).toBe(false);

		setEntitlementState({
			tier: 'pro',
			status: 'invalid',
			enabledFeatures: new Set(['split-chat']),
		});
		expect(canUseFeature('split-chat')).toBe(false);
	});

	it('status가 active여도 enabledFeatures에 없는 기능은 false를 반환한다', () => {
		setEntitlementState({
			tier: 'pro',
			status: 'active',
			enabledFeatures: new Set(),
		});
		expect(get(isProActive)).toBe(true);
		expect(canUseFeature('split-chat')).toBe(false);
	});
});
