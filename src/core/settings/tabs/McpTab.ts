import type { LuminaSettingTab } from '../settingTab';
import { renderAgentSection } from './mcp/AgentSection';
import { renderLocalServerSection } from './mcp/LocalServerSection';
import { renderExternalServersSection } from './mcp/ExternalServersSection';

export { renderMcpServerCard } from './mcp/McpServerCard';

export function renderMcpTab(tab: LuminaSettingTab, el: HTMLElement): void {
	const s = tab.plugin.settings.mcp;

	renderAgentSection(tab, el, s);
	renderLocalServerSection(tab, el, s);
	renderExternalServersSection(tab, el, s);
}