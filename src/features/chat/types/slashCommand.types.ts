export interface SlashCommand {
	id: string;
	name: string;
	description: string;
	icon: string;
	action: () => void;
	/** 명령어 분류 (UI 그룹 헤더 표시용). 미지정 시 'builtin' */
	category?: 'builtin' | 'custom';
}