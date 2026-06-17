/** 설정 창 하단의 후원/링크 푸터 렌더링 */

export function renderDonationFooter(el: HTMLElement, langSuffix: string): void {
	const footer = el.createDiv({ cls: 'lumina-settings__footer' });
	footer.setCssStyles({
		marginTop: '40px',
		paddingTop: '15px',
		paddingBottom: '15px',
		borderTop: '1px solid var(--background-modifier-border)',
		textAlign: 'center',
		fontSize: '0.85em',
		display: 'flex',
		justifyContent: 'center',
		alignItems: 'center',
		flexWrap: 'wrap',
		gap: '20px',
	});

	const label = footer.createSpan({ text: 'Support Lumina:' });
	label.setCssStyles({ color: 'var(--text-muted)', fontWeight: '500', opacity: '0.9' });

	const createLink = (text: string, url: string, isAccent = false) => {
		const a = footer.createEl('a', { text });
		a.href = url;
		a.target = '_blank';
		a.setCssStyles({
			color: isAccent ? 'var(--text-accent)' : 'var(--text-muted)',
			textDecoration: 'none',
			opacity: isAccent ? '0.9' : '0.75',
			fontWeight: isAccent ? '400' : 'normal',
			transition: 'opacity 0.2s',
		});
		a.addEventListener('mouseenter', () => a.setCssStyles({ opacity: '1' }));
		a.addEventListener('mouseleave', () => a.setCssStyles({ opacity: isAccent ? '0.9' : '0.75' }));
	};

	createLink('☕ Ko-fi', 'https://ko-fi.com/luminaapps');
	createLink('☕ Ctee', 'https://ctee.kr/place/luminaapps');

	const separator = footer.createSpan({ text: '|' });
	separator.setCssStyles({ color: 'var(--background-modifier-border)', fontWeight: '500' });

	const readmeUrl = langSuffix === 'EN'
		? 'https://github.com/lumina-apps/obsidian-lumina'
		: `https://github.com/lumina-apps/obsidian-lumina/blob/main/docs/README_${langSuffix}.md`;

	createLink('📖 GitHub README', readmeUrl, true);
}