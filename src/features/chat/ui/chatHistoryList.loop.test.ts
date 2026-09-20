import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mount, unmount } from 'svelte';
import { writable, get } from 'svelte/store';

vi.mock('../../../core/store/chatStore', () => ({
	currentSessionId: writable(null),
}));
vi.mock('../../../core/store/projectStore', () => ({
	activeProjectId: writable('default'),
}));
vi.mock('../../../shared/locales/index', () => ({
	tStore: writable((key: string) => key),
}));
vi.mock('../../../shared/utils/dateUtils', () => ({
	formatDate: () => 'date',
}));
vi.mock('../../../shared/svgIcons', () => ({
	SVG_BACK_ARROW: '',
	SVG_REFRESH: '',
	SVG_TRASH: '',
	SVG_EXPORT: '',
	SVG_EDIT: '',
	SVG_CHECK: '',
	SVG_CLOSE: '',
	SVG_SEARCH: '',
}));
vi.mock('../../../shared/debugLogger', () => ({
	debugLogger: { logError: vi.fn() },
}));

import ChatHistoryList from './ChatHistoryList.svelte';
import { activeProjectId } from '../../../core/store/projectStore';

function makeCtrl() {
	return {
		fetchSessions: vi.fn().mockImplementation(
			() =>
				new Promise((r) =>
					setTimeout(
						() =>
							r([
								{
									id: 's1', title: 'S1', messages: [], createdAt: 1, updatedAt: 1, providerId: '', modelId: '',
								},
							]),
						10,
					),
				),
		),
		restoreSession: vi.fn().mockResolvedValue(true),
		removeSession: vi.fn().mockResolvedValue(true),
		renameSession: vi.fn().mockResolvedValue(true),
		history: { exportSession: vi.fn().mockResolvedValue(true) },
	};
}

describe('ChatHistoryList (regression: infinite loadSessions loop)', () => {
	beforeEach(() => {
		activeProjectId.set('default');
	});

	it('does not reload sessions when activeProjectId is re-notified with the same value', async () => {
		const ctrl = makeCtrl();
		const target = document.createElement('div');
		document.body.appendChild(target);
		let comp: Record<string, unknown> | null = null;
		try {
			comp = mount(ChatHistoryList, {
				target,
				props: { ctrl: ctrl as never, onSessionSelect: () => {}, onBack: () => {} },
			});
			await new Promise((r) => setTimeout(r, 60));
			expect(get(activeProjectId)).toBe('default');
			expect(ctrl.fetchSessions).toHaveBeenCalledTimes(1);

			// 같은 값으로 재알림(syncProjectStore 등)이 여러 번 와도 재호출하지 않아야 함
			activeProjectId.set('default');
			activeProjectId.set('default');
			activeProjectId.set('default');
			await new Promise((r) => setTimeout(r, 60));
			expect(ctrl.fetchSessions).toHaveBeenCalledTimes(1);
		} finally {
			if (comp) unmount(comp);
			target.remove();
		}
	});

	it('reloads only once when the project actually changes', async () => {
		const ctrl = makeCtrl();
		const target = document.createElement('div');
		document.body.appendChild(target);
		let comp: Record<string, unknown> | null = null;
		try {
			comp = mount(ChatHistoryList, {
				target,
				props: { ctrl: ctrl as never, onSessionSelect: () => {}, onBack: () => {} },
			});
			await new Promise((r) => setTimeout(r, 60));
			expect(ctrl.fetchSessions).toHaveBeenCalledTimes(1);

			activeProjectId.set('project-b');
			await new Promise((r) => setTimeout(r, 60));
			expect(ctrl.fetchSessions).toHaveBeenCalledTimes(2);

			// 프로젝트가 다시 바뀌어도 프로젝트당 정확히 1회
			activeProjectId.set('project-c');
			await new Promise((r) => setTimeout(r, 60));
			expect(ctrl.fetchSessions).toHaveBeenCalledTimes(3);
		} finally {
			if (comp) unmount(comp);
			target.remove();
		}
	});

	it('entering rename mode and pressing Enter saves title without triggering onSessionSelect', async () => {
		const ctrl = makeCtrl();
		const onSessionSelect = vi.fn();
		const target = document.createElement('div');
		document.body.appendChild(target);
		let comp: Record<string, unknown> | null = null;
		try {
			comp = mount(ChatHistoryList, {
				target,
				props: { ctrl: ctrl as never, onSessionSelect, onBack: () => {} },
			});
			await new Promise((r) => setTimeout(r, 60));

			// Find the rename button
			const renameBtn = target.querySelector('.lumina-history__action-btn') as HTMLButtonElement;
			expect(renameBtn).toBeTruthy();
			renameBtn.click();
			await new Promise((r) => setTimeout(r, 30));

			// Rename input should now be mounted
			const input = target.querySelector('.lumina-history__rename-input') as HTMLInputElement;
			expect(input).toBeTruthy();

			// Change input value
			input.value = 'New Renamed Title';
			input.dispatchEvent(new Event('input'));

			// Press Enter inside input
			input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
			await new Promise((r) => setTimeout(r, 30));

			expect(ctrl.renameSession).toHaveBeenCalledWith('s1', 'New Renamed Title');
			// Crucial: onSessionSelect must NOT be called when pressing Enter during rename!
			expect(onSessionSelect).not.toHaveBeenCalled();
		} finally {
			if (comp) unmount(comp);
			target.remove();
		}
	});

	it('displays empty search state using common.noResults when query matches nothing', async () => {
		const ctrl = makeCtrl();
		const target = document.createElement('div');
		document.body.appendChild(target);
		let comp: Record<string, unknown> | null = null;
		try {
			comp = mount(ChatHistoryList, {
				target,
				props: { ctrl: ctrl as never, onSessionSelect: () => {}, onBack: () => {} },
			});
			await new Promise((r) => setTimeout(r, 60));

			const searchInput = target.querySelector('.lumina-history__search-input') as HTMLInputElement;
			expect(searchInput).toBeTruthy();
			searchInput.value = 'nonexistent_keyword_xyz';
			searchInput.dispatchEvent(new Event('input'));
			await new Promise((r) => setTimeout(r, 30));

			const emptyEl = target.querySelector('.lumina-history__empty');
			expect(emptyEl).toBeTruthy();
			expect(emptyEl?.textContent?.trim()).toBe('common.noResults');
		} finally {
			if (comp) unmount(comp);
			target.remove();
		}
	});
});
