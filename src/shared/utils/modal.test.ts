import { describe, it, expect } from 'vitest';
import { App } from 'obsidian';
import { ConfirmModal, confirmWithModal } from './modal';

describe('ConfirmModal & confirmWithModal', () => {
	it('확인 버튼 클릭 시 confirmWithModal이 true를 반환한다', async () => {
		const app = new App();
		let modalInstance: ConfirmModal | null = null;
		const origOpen = ConfirmModal.prototype.open;
		ConfirmModal.prototype.open = function (this: ConfirmModal) {
			modalInstance = this;
			origOpen.call(this);
		};

		try {
			const promise = confirmWithModal(app, '삭제 확인', '정말 삭제하시겠습니까?');
			expect(modalInstance).not.toBeNull();

			const buttons = Array.from(modalInstance!.contentEl.querySelectorAll('button'));
			const proceedBtn = buttons[1];
			expect(proceedBtn).toBeDefined();
			proceedBtn.click();

			await expect(promise).resolves.toBe(true);
		} finally {
			ConfirmModal.prototype.open = origOpen;
		}
	});

	it('취소 버튼 클릭 또는 모달 닫기 시 confirmWithModal이 false를 반환한다', async () => {
		const app = new App();
		let modalInstance: ConfirmModal | null = null;
		const origOpen = ConfirmModal.prototype.open;
		ConfirmModal.prototype.open = function (this: ConfirmModal) {
			modalInstance = this;
			origOpen.call(this);
		};

		try {
			const cancelPromise = confirmWithModal(app, '삭제 확인', '취소 테스트');
			const cancelBtn = modalInstance!.contentEl.querySelectorAll('button')[0];
			cancelBtn.click();
			await expect(cancelPromise).resolves.toBe(false);

			// Esc 등 외부 닫기 시에도 false 반환
			const closePromise = confirmWithModal(app, '삭제 확인', '외부 닫기 테스트');
			modalInstance!.close();
			await expect(closePromise).resolves.toBe(false);
		} finally {
			ConfirmModal.prototype.open = origOpen;
		}
	});
});
