import { addIcon } from 'obsidian';

/**
 * Lumina 플러그인에서 사용하는 커스텀 아이콘들을 등록합니다.
 * main.ts onload() 상단에서 호출됩니다.
 */
export function registerLuminaIcons(): void {
	addIcon('lumina-send', `<g transform="scale(4.1667)"><path d="M22 2L11 13M22 2L15 22l-4-9-9-4 20-7z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></g>`);
	addIcon('lumina-square', `<g transform="scale(4.1667)"><rect x="4.5" y="4.5" width="15" height="15" rx="2.5" fill="currentColor"/></g>`);
	addIcon('lumina-message-plus', `<g transform="scale(4.1667)"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="9" y1="10" x2="15" y2="10" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="12" y1="7" x2="12" y2="13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></g>`);
	addIcon('lumina-at-sign', `<g transform="scale(4.1667)"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></g>`);
	addIcon('lumina-server', `<g transform="scale(4.1667)"><rect x="2" y="2" width="20" height="8" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="2" y="14" width="20" height="8" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="2"/><line x1="6" y1="6" x2="6.01" y2="6" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="6" y1="18" x2="6.01" y2="18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></g>`);
}