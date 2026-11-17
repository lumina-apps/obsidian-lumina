import { describe, it, expect } from 'vitest';
import { renderDonationFooter } from './Footer';

describe('renderDonationFooter', () => {
	it('renders Korean priority buttons (Ctee primary, Ko-fi secondary) when langSuffix is KO', () => {
		const container = document.createElement('div');
		renderDonationFooter(container, 'KO');

		const footer = container.querySelector('.lumina-settings__footer');
		expect(footer).not.toBeNull();

		const buttons = Array.from(container.querySelectorAll<HTMLAnchorElement>('.lumina-settings__footer-btn'));
		expect(buttons).toHaveLength(4);

		// 첫 번째 버튼: Ctee (primary)
		expect(buttons[0].href).toBe('https://ctee.kr/place/luminaapps');
		expect(buttons[0].classList.contains('lumina-settings__footer-btn--primary')).toBe(true);

		// 두 번째 버튼: Ko-fi (secondary)
		expect(buttons[1].href).toBe('https://ko-fi.com/luminaapps');
		expect(buttons[1].classList.contains('lumina-settings__footer-btn--secondary')).toBe(true);

		// 세 번째 버튼: GitHub Sponsors (secondary)
		expect(buttons[2].href).toBe('https://github.com/sponsors/lumina-apps');
		expect(buttons[2].classList.contains('lumina-settings__footer-btn--secondary')).toBe(true);

		// 네 번째 버튼: 한국어 README 링크
		expect(buttons[3].href).toBe('https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_KO.md');
		expect(buttons[3].classList.contains('lumina-settings__footer-btn--ghost')).toBe(true);
	});

	it('renders global priority buttons (Ko-fi primary, GitHub Sponsors & Ctee secondary) when langSuffix is EN', () => {
		const container = document.createElement('div');
		renderDonationFooter(container, 'EN');

		const buttons = Array.from(container.querySelectorAll<HTMLAnchorElement>('.lumina-settings__footer-btn'));
		expect(buttons).toHaveLength(4);

		// 첫 번째 버튼: Ko-fi (primary)
		expect(buttons[0].href).toBe('https://ko-fi.com/luminaapps');
		expect(buttons[0].classList.contains('lumina-settings__footer-btn--primary')).toBe(true);

		// 두 번째 버튼: GitHub Sponsors (secondary)
		expect(buttons[1].href).toBe('https://github.com/sponsors/lumina-apps');
		expect(buttons[1].classList.contains('lumina-settings__footer-btn--secondary')).toBe(true);

		// 세 번째 버튼: Ctee (secondary)
		expect(buttons[2].href).toBe('https://ctee.kr/place/luminaapps');
		expect(buttons[2].classList.contains('lumina-settings__footer-btn--secondary')).toBe(true);

		// 네 번째 버튼: 기본 GitHub 저장소 링크
		expect(buttons[3].href).toBe('https://github.com/lumina-apps/obsidian-lumina');
	});
});
