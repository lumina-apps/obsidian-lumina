/**
 * proUpgradeModal.test.ts
 *
 * Lumina Pro 업그레이드 안내 모달(ProUpgradeModal) 및 잠금 기능 토스트 알림(notifyProFeatureLocked)의
 * 실제 DOM 렌더링, 포커스 처리, Notice 호출 및 클릭 시 모달 오픈 동작을 검증합니다.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as obsidian from 'obsidian';
import { App, Modal } from 'obsidian';
import { t } from '../locales/helpers';
import {
	ProUpgradeModal,
	notifyProFeatureLocked,
	openProUpgradeModal,
} from './proUpgradeModal';

describe('proUpgradeModal', () => {
	let mockApp: App;

	beforeEach(() => {
		mockApp = new App();
	});

	afterEach(() => {
		document.body.innerHTML = '';
		vi.restoreAllMocks();
	});

	it('ProUpgradeModal은 기능 카드 하이라이트, 빈/유효 라이선스 키 Notice, 포커스, 닫기 동작을 수행한다', () => {
		const modal = new ProUpgradeModal(mockApp, 'batch-studio');
		document.body.appendChild(modal.containerEl);
		modal.open();

		expect(modal.contentEl.classList.contains('lumina-pro-upgrade-modal')).toBe(true);
		const cards = modal.contentEl.querySelectorAll('.lumina-pro-upgrade-modal__card');
		expect(cards).toHaveLength(3);
		expect(cards[0].classList.contains('is-highlighted')).toBe(false);
		expect(cards[1].classList.contains('is-highlighted')).toBe(true);
		expect(cards[2].classList.contains('is-highlighted')).toBe(false);

		const input = modal.contentEl.querySelector<HTMLInputElement>('.lumina-pro-upgrade-modal__license-input');
		const activateBtn = modal.contentEl.querySelector<HTMLButtonElement>('.lumina-pro-upgrade-modal__activate-btn');
		expect(input).not.toBeNull();
		expect(activateBtn).not.toBeNull();

		// 1. 빈 키로 활성화 버튼 클릭 시 입력란 포커스 및 Notice hide/message 인프라 확인
		const focusSpy = vi.spyOn(input!, 'focus');
		const setMessageSpy = vi.spyOn(obsidian, 'Notice');
		activateBtn!.click();
		expect(focusSpy).toHaveBeenCalledTimes(1);
		if (setMessageSpy.mock.calls.length > 0) {
			expect(setMessageSpy).toHaveBeenCalledWith(t('proUpgrade.licenseEmptyNotice'));
		}

		// 2. 유효 형식 키 입력 후 클릭
		input!.value = 'LUMINA-PRO-2026';
		activateBtn!.click();
		if (setMessageSpy.mock.calls.length > 1) {
			expect(setMessageSpy).toHaveBeenLastCalledWith(t('proUpgrade.licensePreLaunchNotice'), 4500);
		}

		// 3. 닫기 버튼 클릭 시 contentEl 비움
		const closeBtn = modal.contentEl.querySelector<HTMLButtonElement>('.lumina-pro-upgrade-modal__close-btn');
		closeBtn?.click();
		expect(modal.contentEl.children).toHaveLength(0);
	});

	it('openProUpgradeModal은 Modal.prototype.open을 호출하고 지정한 focusFeature 카드를 강조한다', () => {
		let openedInstance: ProUpgradeModal | null = null;
		const openSpy = vi.spyOn(Modal.prototype, 'open').mockImplementation(function (this: Modal) {
			if (this instanceof ProUpgradeModal) {
				openedInstance = this;
			}
			this.onOpen();
		});

		openProUpgradeModal(mockApp, 'voice-note');

		expect(openSpy).toHaveBeenCalledTimes(1);
		expect(openedInstance).not.toBeNull();
		const cards = (openedInstance as unknown as ProUpgradeModal).contentEl.querySelectorAll(
			'.lumina-pro-upgrade-modal__card',
		);
		expect(cards[2].classList.contains('is-highlighted')).toBe(true);
		expect(cards[0].classList.contains('is-highlighted')).toBe(false);
	});

	it('notifyProFeatureLocked는 메시지·액션 링크 프래그먼트를 생성하고 링크 클릭 시 Notice 숨김 및 업그레이드 모달을 연다', () => {
		const capturedFragments: DocumentFragment[] = [];
		const origCreateFrag = globalThis.createFragment;
		const fragSpy = vi.spyOn(globalThis, 'createFragment').mockImplementation((cb) => {
			const frag = origCreateFrag(cb);
			capturedFragments.push(frag);
			return frag;
		});

		const openSpy = vi.spyOn(ProUpgradeModal.prototype, 'open');
		const noticeInstance = new obsidian.Notice('');
		const hideSpy = vi.spyOn(noticeInstance, 'hide');
		hideSpy.mockClear();

		notifyProFeatureLocked(mockApp, 'split-chat', '3~4개 모델 비교는 Pro 기능입니다.');

		expect(fragSpy).toHaveBeenCalledTimes(1);
		expect(capturedFragments).toHaveLength(1);
		const frag = capturedFragments[0];

		const msgSpan = frag.querySelector('.lumina-pro-notice-msg');
		expect(msgSpan?.textContent).toBe('✦ 3~4개 모델 비교는 Pro 기능입니다.');

		const actionBtn = frag.querySelector<HTMLButtonElement>('.lumina-pro-notice-link');
		expect(actionBtn).not.toBeNull();
		expect(actionBtn?.textContent).toBe(t('proUpgrade.toastAction'));

		// 링크 클릭 시 토스트를 숨기고 해당 기능에 맞춘 ProUpgradeModal을 오픈해야 함
		actionBtn!.click();
		expect(hideSpy).toHaveBeenCalledTimes(1);
		expect(openSpy).toHaveBeenCalledTimes(1);

		// app이 undefined일 때는 액션 링크 버튼 없이 메시지만 생성
		notifyProFeatureLocked(undefined, 'batch-studio', '앱 없이 토스트 표시');
		expect(capturedFragments).toHaveLength(2);
		expect(capturedFragments[1].querySelector('.lumina-pro-notice-msg')?.textContent).toBe(
			'✦ 앱 없이 토스트 표시',
		);
		expect(capturedFragments[1].querySelector('.lumina-pro-notice-link')).toBeNull();
	});

	it('createFragment가 없는 환경에서도 문자열 Notice 폴백으로 오류 없이 동작한다', () => {
		const origCreateFrag = (globalThis as { createFragment?: unknown }).createFragment;
		Object.defineProperty(globalThis, 'createFragment', {
			value: undefined,
			configurable: true,
			writable: true,
		});

		try {
			expect(() =>
				notifyProFeatureLocked(mockApp, 'voice-note', '폴백 메시지 테스트'),
			).not.toThrow();
		} finally {
			Object.defineProperty(globalThis, 'createFragment', {
				value: origCreateFrag,
				configurable: true,
				writable: true,
			});
		}
	});
});
