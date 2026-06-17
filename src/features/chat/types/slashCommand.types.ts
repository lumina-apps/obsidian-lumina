export interface SlashCommand {
	id: string;
	name: string;
	description: string;
	icon: string;
	action: () => void;
}