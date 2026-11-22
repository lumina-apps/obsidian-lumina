import type { SlashCommand } from '../types/slashCommand.types';
import type { QuickAction } from '../../../shared/types/settings.types';
import { resolveQuickActionSlashIds } from '../../../shared/utils/slashCommandId';

const MAX_DESCRIPTION_LENGTH = 80;

/**
 * 프롬프트 첫 줄을 추출해 슬래시 목록용 설명 미리보기(최대 80자)를 만듭니다.
 */
function buildPromptPreview(prompt: string): string {
	const firstLine = prompt
		.split(/\r?\n/)
		.map((line) => line.trim())
		.find((line) => line.length > 0) ?? '';

	if (firstLine.length <= MAX_DESCRIPTION_LENGTH) {
		return firstLine;
	}
	return `${firstLine.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…`;
}

/**
 * 사용자가 등록한 퀵 액션 목록을 채팅 입력창 슬래시(/) 명령어 배열로 변환합니다.
 */
export function buildCustomPromptCommands(
	actions: readonly QuickAction[],
	onInsert: (action: QuickAction) => void,
): SlashCommand[] {
	const idMap = resolveQuickActionSlashIds(actions);
	const commands: SlashCommand[] = [];

	for (const action of actions) {
		const slashId = idMap.get(action.id);
		if (!slashId) continue;

		commands.push({
			id: slashId,
			name: action.name.trim() || slashId,
			description: buildPromptPreview(action.prompt),
			icon: 'sparkles',
			category: 'custom',
			action: () => onInsert(action),
		});
	}

	return commands;
}
