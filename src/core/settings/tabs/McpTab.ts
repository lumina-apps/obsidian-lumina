import { Platform } from 'obsidian';
import type { LuminaSettingTab } from '../settingTab';
import { renderAgentSection } from './mcp/AgentSection';
import { renderLocalServerSection } from './mcp/LocalServerSection';
import { renderExternalServersSection } from './mcp/ExternalServersSection';

export { renderMcpServerCard } from './mcp/McpServerCard';

export function renderMcpTab(tab: LuminaSettingTab, el: HTMLElement): void {
	const s = tab.plugin.settings.mcp;

	renderAgentSection(tab, el, s);
	// 로컬 HTTP MCP 서버 및 외부 서버 연결은 데스크탑 환경에서만 지원
	if (!Platform.isMobile) {
		renderLocalServerSection(tab, el, s);
		renderExternalServersSection(tab, el, s);
	}
}