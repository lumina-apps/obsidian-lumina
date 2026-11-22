import { describe, it, expect, vi } from 'vitest';
import { buildCustomPromptCommands } from './customSlashCommandUtils';
import { resolveQuickActionSlashIds } from '../../../shared/utils/slashCommandId';
import type { QuickAction } from '../../../shared/types/settings.types';

function makeAction(overrides: Partial<QuickAction> & { id: string }): QuickAction {
	return {
		name: '테스트',
		prompt: '프롬프트 본문',
		actionType: 'chat',
		...overrides,
	};
}

describe('customSlashCommandUtils', () => {
	it('퀵 액션을 custom 카테고리의 SlashCommand로 변환한다', () => {
		const actions: QuickAction[] = [
			makeAction({
				id: 'qa-1',
				name: '한국어로 번역',
				prompt: '다음 텍스트를 자연스러운 한국어로 번역해줘:\n\n',
				actionType: 'replace',
			}),
			makeAction({
				id: 'qa-2',
				name: 'Empty Prompt',
				prompt: '   ',
			}),
		];

		const onInsert = vi.fn();
		const cmds = buildCustomPromptCommands(actions, onInsert);
		const expectedIds = resolveQuickActionSlashIds(actions);

		expect(cmds).toHaveLength(1);
		expect(cmds[0].id).toBe(expectedIds.get('qa-1'));
		expect(cmds[0].name).toBe('한국어로 번역');
		expect(cmds[0].description).toBe('다음 텍스트를 자연스러운 한국어로 번역해줘:');
		expect(cmds[0].icon).toBe('sparkles');
		expect(cmds[0].category).toBe('custom');

		cmds[0].action();
		expect(onInsert).toHaveBeenCalledTimes(1);
		expect(onInsert).toHaveBeenCalledWith(actions[0]);
	});

	it('긴 프롬프트의 description은 80자로 줄여 말줄임표를 붙인다', () => {
		const longPrompt = '가'.repeat(100);
		const actions: QuickAction[] = [
			makeAction({ id: 'qa-1', name: '긴 프롬프트', prompt: longPrompt }),
		];

		const cmds = buildCustomPromptCommands(actions, vi.fn());
		expect(cmds[0].description).toHaveLength(80);
		expect(cmds[0].description.endsWith('…')).toBe(true);
	});
});
