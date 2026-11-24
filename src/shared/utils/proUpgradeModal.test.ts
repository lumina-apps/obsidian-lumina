import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { App } from 'obsidian';
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
		vi.restoreAllMocks();
	});

	it('ProUpgradeModal은 3개 Pro 기능 카드와 라이선스 입력란을 정상 렌더링한다', () => {
		const modal = new ProUpgradeModal(mockApp, 'batch-studio');
		modal.open();

		expect(modal.contentEl.classList.contains('lumina-pro-upgrade-modal')).toBe(true);
		const cards = modal.contentEl.querySelectorAll('.lumina-pro-upgrade-modal__card');
		expect(cards).toHaveLength(3);
		expect(cards[1].classList.contains('is-highlighted')).toBe(true);

		const input = modal.contentEl.querySelector<HTMLInputElement>('.lumina-pro-upgrade-modal__license-input');
		expect(input).not.toBeNull();

		const activateBtn = modal.contentEl.querySelector<HTMLButtonElement>('.lumina-pro-upgrade-modal__activate-btn');
		activateBtn?.click();

		if (input) {
			input.value = 'LUMINA-TEST-KEY';
		}
		activateBtn?.click();

		const closeBtn = modal.contentEl.querySelector<HTMLButtonElement>('.lumina-pro-upgrade-modal__close-btn');
		closeBtn?.click();
		expect(modal.contentEl.children).toHaveLength(0);
	});

	it('openProUpgradeModal은 모달을 오류 없이 생성·오픈한다', () => {
		expect(() => openProUpgradeModal(mockApp, 'voice-note')).not.toThrow();
	});

	it('notifyProFeatureLocked는 토스트 안내와 상세 모달 액션 링크를 오류 없이 생성한다', () => {
		expect(() =>
			notifyProFeatureLocked(mockApp, 'split-chat', '3~4개 모델 비교는 Pro 기능입니다.'),
		).not.toThrow();
		expect(() =>
			notifyProFeatureLocked(undefined, 'split-chat', '앱 없이도 토스트만 표시 가능해야 합니다.'),
		).not.toThrow();
	});
});
