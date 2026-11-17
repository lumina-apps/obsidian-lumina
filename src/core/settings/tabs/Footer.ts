import { t } from '../../../shared/locales/helpers';

/** 설정 창 하단의 후원/링크 푸터 렌더링 */

export function renderDonationFooter(el: HTMLElement, langSuffix: string): void {
	const footer = el.createDiv({ cls: 'lumina-settings__footer' });

	// 좌측: 후원 타이틀 및 설명 문구 영역
	const info = footer.createDiv({ cls: 'lumina-settings__footer-info' });
	const titleRow = info.createDiv({ cls: 'lumina-settings__footer-title' });
	titleRow.createSpan({ text: '💖', cls: 'lumina-settings__footer-icon' });
	titleRow.createSpan({ text: t('settings.misc.donate.name') });

	info.createDiv({
		cls: 'lumina-settings__footer-desc',
		text: t('settings.misc.donate.desc'),
	});

	// 우측: 후원 및 GitHub 링크 버튼 영역
	const actions = footer.createDiv({ cls: 'lumina-settings__footer-actions' });

	const createActionBtn = (text: string, url: string, variant: 'primary' | 'secondary' | 'ghost' = 'secondary') => {
		const a = actions.createEl('a', {
			text,
			cls: `lumina-settings__footer-btn lumina-settings__footer-btn--${variant}`,
		});
		a.href = url;
		a.target = '_blank';
		a.rel = 'noopener noreferrer';
	};

	const isKorean = langSuffix === 'KO';
	if (isKorean) {
		createActionBtn(t('settings.misc.donate.ctee'), 'https://ctee.kr/place/luminaapps', 'primary');
		createActionBtn(t('settings.misc.donate.kofi'), 'https://ko-fi.com/luminaapps', 'secondary');
		createActionBtn(t('settings.misc.donate.githubSponsors'), 'https://github.com/sponsors/lumina-apps', 'secondary');
	} else {
		createActionBtn(t('settings.misc.donate.kofi'), 'https://ko-fi.com/luminaapps', 'primary');
		createActionBtn(t('settings.misc.donate.githubSponsors'), 'https://github.com/sponsors/lumina-apps', 'secondary');
		createActionBtn(t('settings.misc.donate.ctee'), 'https://ctee.kr/place/luminaapps', 'secondary');
	}

	const readmeUrl = langSuffix === 'EN'
		? 'https://github.com/lumina-apps/obsidian-lumina'
		: `https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_${langSuffix}.md`;

	createActionBtn('⭐ GitHub', readmeUrl, 'ghost');
}
