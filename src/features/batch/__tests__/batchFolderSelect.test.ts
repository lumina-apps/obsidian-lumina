import { describe, it, expect, vi, afterEach } from 'vitest';
import { flushSync, mount, unmount } from 'svelte';
import BatchFolderSelect from '../ui/BatchFolderSelect.svelte';

describe('BatchFolderSelect', () => {
	let container: HTMLDivElement | null = null;
	let instance: Record<string, unknown> | null = null;

	afterEach(() => {
		if (instance) {
			unmount(instance);
			instance = null;
		}
		container?.remove();
		container = null;
	});

	it('이미 특정 폴더가 선택된 상태에서 다시 열어도 전체 폴더 목록을 보여주고, 직접 타이핑할 때만 필터링한다', () => {
		container = document.createElement('div');
		document.body.appendChild(container);

		const folders = ['Archive', 'Film 1', 'Film 2', 'Projects'];
		const onChange = vi.fn();

		instance = mount(BatchFolderSelect, {
			target: container,
			props: {
				folders,
				value: 'Film 1',
				onChange,
			},
		});

		const input = container.querySelector('input') as HTMLInputElement;
		expect(input).not.toBeNull();

		// 1) 선택값이 'Film 1'인 상태에서 클릭해도 전체 4개 폴더가 모두 노출되어야 함
		input.click();
		flushSync();
		const allOptions = Array.from(document.querySelectorAll('[role="option"]')).map(
			(el) => el.textContent?.trim(),
		);
		expect(allOptions).toEqual(folders);

		// 2) 직접 타이핑하면 입력어로 필터링되어야 함
		input.value = 'proj';
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		expect(onChange).toHaveBeenCalledWith('proj');

		// props.value가 부모에 의해 갱신된 상황 시뮬레이션
		unmount(instance);
		instance = mount(BatchFolderSelect, {
			target: container,
			props: {
				folders,
				value: 'Film',
				onChange,
			},
		});
		const input2 = container.querySelector('input') as HTMLInputElement;
		input2.value = 'Film';
		input2.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();

		const filteredOptions = Array.from(document.querySelectorAll('[role="option"]')).map(
			(el) => el.textContent?.trim(),
		);
		expect(filteredOptions).toEqual(['Film 1', 'Film 2']);
	});
});
