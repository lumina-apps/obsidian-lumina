import { App, Modal, Notice, setIcon } from 'obsidian';
import { t } from '../locales/helpers';
import type { ProFeatureId } from '../types/entitlement.types';

/**
 * Lumina Pro 업그레이드 안내 및 라이선스 키 등록을 한 화면에서 제공하는 통합 모달.
 * 잠긴 버튼 클릭 시 바로 모달을 띄우지 않고, 토스트의 안내 링크를 클릭했을 때만 열립니다.
 */
export class ProUpgradeModal extends Modal {
	private focusFeature?: ProFeatureId;

	constructor(app: App, focusFeature?: ProFeatureId) {
		super(app);
		this.focusFeature = focusFeature;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('lumina-pro-upgrade-modal');

		// 1. 헤더 (PRO 배지 + 제목 + 설명)
		const headerEl = contentEl.createDiv({ cls: 'lumina-pro-upgrade-modal__header' });
		const titleRow = headerEl.createDiv({ cls: 'lumina-pro-upgrade-modal__title-row' });
		titleRow.createSpan({ text: 'PRO', cls: 'lumina-pro-upgrade-modal__badge' });
		titleRow.createEl('h2', {
			text: t('proUpgrade.modalTitle'),
			cls: 'lumina-pro-upgrade-modal__title',
		});
		headerEl.createEl('p', {
			text: t('proUpgrade.modalSubtitle'),
			cls: 'lumina-pro-upgrade-modal__subtitle',
		});

		// 2. Pro 기능별 혜택 카드 목록
		const listEl = contentEl.createDiv({ cls: 'lumina-pro-upgrade-modal__features' });
		const items: Array<{
			id: ProFeatureId;
			icon: string;
			title: string;
			desc: string;
		}> = [
			{
				id: 'split-chat',
				icon: 'lumina-split-chat',
				title: t('proUpgrade.splitTitle'),
				desc: t('proUpgrade.splitDesc'),
			},
			{
				id: 'batch-studio',
				icon: 'lumina-batch-studio',
				title: t('proUpgrade.batchTitle'),
				desc: t('proUpgrade.batchDesc'),
			},
			{
				id: 'voice-note',
				icon: 'lumina-voice-note',
				title: t('proUpgrade.voiceTitle'),
				desc: t('proUpgrade.voiceDesc'),
			},
		];

		for (const item of items) {
			const card = listEl.createDiv({
				cls: `lumina-pro-upgrade-modal__card${this.focusFeature === item.id ? ' is-highlighted' : ''}`,
			});
			const iconEl = card.createSpan({ cls: 'lumina-pro-upgrade-modal__card-icon' });
			setIcon(iconEl, item.icon);
			const bodyEl = card.createDiv({ cls: 'lumina-pro-upgrade-modal__card-body' });
			bodyEl.createDiv({ text: item.title, cls: 'lumina-pro-upgrade-modal__card-title' });
			bodyEl.createDiv({ text: item.desc, cls: 'lumina-pro-upgrade-modal__card-desc' });
		}

		// 3. 라이선스 키 등록 섹션 (추후 결제·인증 서버 연동 단일 지점)
		const licenseBox = contentEl.createDiv({ cls: 'lumina-pro-upgrade-modal__license' });
		licenseBox.createDiv({
			text: t('proUpgrade.licenseHeading'),
			cls: 'lumina-pro-upgrade-modal__license-heading',
		});
		const inputRow = licenseBox.createDiv({ cls: 'lumina-pro-upgrade-modal__license-row' });
		const keyInput = inputRow.createEl('input', {
			cls: 'lumina-pro-upgrade-modal__license-input',
			attr: {
				type: 'text',
				placeholder: t('proUpgrade.licensePlaceholder'),
				spellcheck: 'false',
				autocomplete: 'off',
			},
		});
		const activateBtn = inputRow.createEl('button', {
			text: t('proUpgrade.activateBtn'),
			cls: 'mod-cta lumina-pro-upgrade-modal__activate-btn',
			attr: { type: 'button' },
		});
		activateBtn.addEventListener('click', () => {
			if (!keyInput.value.trim()) {
				new Notice(t('proUpgrade.licenseEmptyNotice'));
				keyInput.focus();
				return;
			}
			new Notice(t('proUpgrade.licensePreLaunchNotice'), 4500);
		});

		// 4. 닫기 푸터
		const actionsEl = contentEl.createDiv({ cls: 'lumina-pro-upgrade-modal__actions' });
		const closeBtn = actionsEl.createEl('button', {
			text: t('proUpgrade.closeBtn'),
			cls: 'lumina-pro-upgrade-modal__close-btn',
			attr: { type: 'button' },
		});
		closeBtn.addEventListener('click', () => {
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Lumina Pro 안내 및 라이선스 등록 통합 모달을 엽니다.
 */
export function openProUpgradeModal(app: App, focusFeature?: ProFeatureId): void {
	new ProUpgradeModal(app, focusFeature).open();
}

/**
 * 잠긴 Pro 기능을 클릭했을 때 모달로 작업을 방해하지 않고,
 * 토스트(Notice)와 클릭 가능한 상세 안내 링크를 표시합니다.
 */
export function notifyProFeatureLocked(
	app: App | undefined,
	feature: ProFeatureId,
	message: string,
): void {
	if (typeof document === 'undefined') {
		new Notice(message, 4500);
		return;
	}

	const frag = document.createDocumentFragment();
	frag.createEl('span', {
		text: `✦ ${message}`,
		cls: 'lumina-pro-notice-msg',
	});

	let actionBtn: HTMLButtonElement | null = null;
	if (app) {
		actionBtn = frag.createEl('button', {
			text: t('proUpgrade.toastAction'),
			cls: 'lumina-pro-notice-link',
			attr: { type: 'button' },
		});
	}

	const notice = new Notice(frag, 5000);
	if (actionBtn && app) {
		actionBtn.addEventListener('click', (ev) => {
			ev.preventDefault();
			ev.stopPropagation();
			notice.hide();
			openProUpgradeModal(app, feature);
		});
	}
}
