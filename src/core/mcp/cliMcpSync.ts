import type { App } from 'obsidian';
import { debugLogger } from '../../shared/debugLogger';
import { ProcessManager } from '../llm-providers/cli/process-manager';

export interface CliMcpSyncParams {
	port: number;
	authToken: string;
}

/**
 * CLI 에이전트(Claude Code, OpenCode, Codex 등)의 설정 파일에
 * Lumina 로컬 MCP 서버 엔드포인트를 등록 및 정리하는 관리 클래스.
 * 
 * [안전 원칙]:
 * 1. 시스템 전역 설정(예: ~/.gemini/config/mcp_config.json)을 건드리는 agy mcp add는
 *    옵시디언 종료 후 외부 터미널 에러를 유발하므로 자동 등록하지 않습니다.
 * 2. 볼트 내에 생성된 설정 파일(.mcp.json, .claude/mcp.json, opencode.json, .codex/config.toml)은
 *    정리(cleanup) 시 lumina 설정을 제거하고, 다른 설정이 없으면 파일 자체를 삭제하여 볼트를 깨끗하게 유지합니다.
 */
export class CliMcpSync {
	private app: App;

	constructor(app: App) {
		this.app = app;
	}

	/**
	 * 로컬 MCP 서버 시작 또는 포트/토큰 변경 시 CLI 볼트 설정에 엔드포인트를 등록/갱신합니다.
	 */
	public async sync(params: CliMcpSyncParams): Promise<void> {
		const results = await Promise.allSettled([
			this.syncClaudeCode(params),
			this.syncOpenCode(params),
			this.syncCodex(params),
		]);

		for (const res of results) {
			if (res.status === 'rejected') {
				debugLogger.logWarn('mcp', `CLI MCP auto-sync partial failure: ${res.reason}`);
			}
		}
	}

	/**
	 * 로컬 MCP 서버 중지, 동기화 옵션 해제, 또는 플러그인 종료 시 등록된 Lumina 설정을 완전 정리합니다.
	 */
	public async cleanup(): Promise<void> {
		const results = await Promise.allSettled([
			this.cleanupClaudeCode(),
			this.cleanupOpenCode(),
			this.cleanupCodex(),
			this.cleanupAntigravity(),
		]);

		for (const res of results) {
			if (res.status === 'rejected') {
				debugLogger.logWarn('mcp', `CLI MCP cleanup partial failure: ${res.reason}`);
			}
		}
	}

	// ─── 1. Claude Code (.claude/mcp.json & .mcp.json) ──────────────────────

	private async syncClaudeCode(params: CliMcpSyncParams): Promise<void> {
		try {
			const dirPath = '.claude';
			const filePath = '.claude/mcp.json';

			if (!(await this.app.vault.adapter.exists(dirPath))) {
				await this.app.vault.adapter.mkdir(dirPath);
			}

			let config: { mcpServers?: Record<string, unknown> } = {};
			if (await this.app.vault.adapter.exists(filePath)) {
				try {
					const raw = await this.app.vault.adapter.read(filePath);
					const parsed: unknown = JSON.parse(raw);
					if (parsed && typeof parsed === 'object') {
						config = parsed;
					}
				} catch {
					config = {};
				}
			}

			config.mcpServers = config.mcpServers || {};
			config.mcpServers['lumina'] = {
				url: `http://localhost:${params.port}/sse`,
				headers: {
					Authorization: `Bearer ${params.authToken}`,
				},
			};

			await this.app.vault.adapter.write(filePath, JSON.stringify(config, null, 2));
			debugLogger.logSystem('mcp', `[CliMcpSync] Claude Code MCP synced to ${filePath}`);
		} catch (e) {
			debugLogger.logWarn('mcp', `[CliMcpSync] Failed to sync Claude Code MCP: ${e}`);
		}
	}

	private async cleanupClaudeCode(): Promise<void> {
		// 1) .claude/mcp.json 정리
		try {
			const filePath = '.claude/mcp.json';
			if (await this.app.vault.adapter.exists(filePath)) {
				const raw = await this.app.vault.adapter.read(filePath);
				const config = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
				if (config.mcpServers && 'lumina' in config.mcpServers) {
					delete config.mcpServers['lumina'];
					
					const remainingServers = Object.keys(config.mcpServers);
					const remainingKeys = Object.keys(config).filter(k => k !== 'mcpServers');
					if (remainingServers.length === 0 && remainingKeys.length === 0) {
						if (typeof this.app.vault.adapter.remove === 'function') {
							await this.app.vault.adapter.remove(filePath);
						} else {
							await this.app.vault.adapter.write(filePath, JSON.stringify({}, null, 2));
						}
						debugLogger.logSystem('mcp', `[CliMcpSync] Cleaned up and removed empty ${filePath}`);
					} else {
						await this.app.vault.adapter.write(filePath, JSON.stringify(config, null, 2));
						debugLogger.logSystem('mcp', `[CliMcpSync] Claude Code MCP lumina removed in ${filePath}`);
					}
				}
			}
		} catch (e) {
			debugLogger.logWarn('mcp', `[CliMcpSync] Failed to clean up .claude/mcp.json: ${e}`);
		}

		// 2) 루트 .mcp.json에 혹시 등록되어 있던 경우도 정리
		try {
			const rootMcpPath = '.mcp.json';
			if (await this.app.vault.adapter.exists(rootMcpPath)) {
				const raw = await this.app.vault.adapter.read(rootMcpPath);
				const config = JSON.parse(raw) as { mcpServers?: Record<string, unknown> };
				if (config.mcpServers && 'lumina' in config.mcpServers) {
					delete config.mcpServers['lumina'];
					const remainingServers = Object.keys(config.mcpServers);
					const remainingKeys = Object.keys(config).filter(k => k !== 'mcpServers');
					if (remainingServers.length === 0 && remainingKeys.length === 0) {
						if (typeof this.app.vault.adapter.remove === 'function') {
							await this.app.vault.adapter.remove(rootMcpPath);
						} else {
							await this.app.vault.adapter.write(rootMcpPath, JSON.stringify({}, null, 2));
						}
					} else {
						await this.app.vault.adapter.write(rootMcpPath, JSON.stringify(config, null, 2));
					}
				}
			}
		} catch {
			// ignore
		}
	}

	// ─── 2. OpenCode (opencode.json) ───────────────────────────────────────

	private async syncOpenCode(params: CliMcpSyncParams): Promise<void> {
		try {
			const filePath = 'opencode.json';
			let config: { $schema?: string; mcp?: Record<string, unknown> } = {};

			if (await this.app.vault.adapter.exists(filePath)) {
				try {
					const raw = await this.app.vault.adapter.read(filePath);
					const parsed: unknown = JSON.parse(raw);
					if (parsed && typeof parsed === 'object') {
						config = parsed;
					}
				} catch {
					config = {};
				}
			}

			if (!config.$schema) {
				config.$schema = 'https://opencode.ai/config.json';
			}
			config.mcp = config.mcp || {};
			config.mcp['lumina'] = {
				type: 'remote',
				url: `http://localhost:${params.port}/sse`,
				headers: {
					Authorization: `Bearer ${params.authToken}`,
				},
			};

			await this.app.vault.adapter.write(filePath, JSON.stringify(config, null, 2));
			debugLogger.logSystem('mcp', `[CliMcpSync] OpenCode MCP synced to ${filePath}`);
		} catch (e) {
			debugLogger.logWarn('mcp', `[CliMcpSync] Failed to sync OpenCode MCP: ${e}`);
		}
	}

	private async cleanupOpenCode(): Promise<void> {
		try {
			const filePath = 'opencode.json';
			if (await this.app.vault.adapter.exists(filePath)) {
				const raw = await this.app.vault.adapter.read(filePath);
				const config = JSON.parse(raw) as { $schema?: string; mcp?: Record<string, unknown> };
				if (config.mcp && 'lumina' in config.mcp) {
					delete config.mcp['lumina'];

					const remainingMcp = Object.keys(config.mcp);
					const otherKeys = Object.keys(config).filter(k => k !== 'mcp' && k !== '$schema');
					if (remainingMcp.length === 0 && otherKeys.length === 0) {
						if (typeof this.app.vault.adapter.remove === 'function') {
							await this.app.vault.adapter.remove(filePath);
						} else {
							await this.app.vault.adapter.write(filePath, JSON.stringify({}, null, 2));
						}
						debugLogger.logSystem('mcp', `[CliMcpSync] Cleaned up and removed empty ${filePath}`);
					} else {
						await this.app.vault.adapter.write(filePath, JSON.stringify(config, null, 2));
						debugLogger.logSystem('mcp', `[CliMcpSync] OpenCode MCP lumina removed in ${filePath}`);
					}
				}
			}
		} catch (e) {
			debugLogger.logWarn('mcp', `[CliMcpSync] Failed to clean up OpenCode MCP: ${e}`);
		}
	}

	// ─── 3. Codex (.codex/config.toml) ─────────────────────────────────────

	private async syncCodex(params: CliMcpSyncParams): Promise<void> {
		try {
			const dirPath = '.codex';
			const filePath = '.codex/config.toml';

			if (!(await this.app.vault.adapter.exists(dirPath))) {
				await this.app.vault.adapter.mkdir(dirPath);
			}

			const luminaSection = [
				'[mcp_servers.lumina]',
				`url = "http://localhost:${params.port}/sse"`,
				`http_headers = { Authorization = "Bearer ${params.authToken}" }`,
			].join('\n');

			let existingContent = '';
			if (await this.app.vault.adapter.exists(filePath)) {
				try {
					existingContent = await this.app.vault.adapter.read(filePath);
				} catch {
					existingContent = '';
				}
			}

			let updatedContent: string;
			const sectionRegex = /(?:^|\n)\[mcp_servers\.lumina\][\s\S]*?(?=\n\[|\s*$)/;
			if (sectionRegex.test(existingContent)) {
				updatedContent = existingContent.replace(sectionRegex, (match) => {
					const startsWithNewline = match.startsWith('\n');
					return (startsWithNewline ? '\n' : '') + luminaSection;
				});
			} else {
				const trimmed = existingContent.trim();
				updatedContent = trimmed ? `${trimmed}\n\n${luminaSection}\n` : `${luminaSection}\n`;
			}

			await this.app.vault.adapter.write(filePath, updatedContent);
			debugLogger.logSystem('mcp', `[CliMcpSync] Codex MCP synced to ${filePath}`);
		} catch (e) {
			debugLogger.logWarn('mcp', `[CliMcpSync] Failed to sync Codex MCP: ${e}`);
		}
	}

	private async cleanupCodex(): Promise<void> {
		// 1) .codex/config.toml 정리
		try {
			const filePath = '.codex/config.toml';
			if (await this.app.vault.adapter.exists(filePath)) {
				const content = await this.app.vault.adapter.read(filePath);
				const sectionRegex = /(?:^|\n)\[mcp_servers\.lumina\][\s\S]*?(?=\n\[|\s*$)/;

				if (sectionRegex.test(content)) {
					const cleaned = content.replace(sectionRegex, '').trim();

					// 다른 섹션이나 실질적 설정 내용이 남아있지 않으면 파일 삭제
					const hasOtherSections = /\[mcp_servers\.[^\]]+\]/.test(cleaned) || /\[[^\]]+\]/.test(cleaned);
					if (!cleaned || !hasOtherSections) {
						if (typeof this.app.vault.adapter.remove === 'function') {
							await this.app.vault.adapter.remove(filePath);
						} else {
							await this.app.vault.adapter.write(filePath, '');
						}
						debugLogger.logSystem('mcp', `[CliMcpSync] Cleaned up and removed empty ${filePath}`);
					} else {
						await this.app.vault.adapter.write(filePath, `${cleaned}\n`);
						debugLogger.logSystem('mcp', `[CliMcpSync] Codex MCP lumina removed in ${filePath}`);
					}
				}
			}
		} catch (e) {
			debugLogger.logWarn('mcp', `[CliMcpSync] Failed to clean up .codex/config.toml: ${e}`);
		}

		// 2) 레거시 codex.json 잔여물이 있을 경우 안전하게 삭제
		try {
			const legacyPath = 'codex.json';
			if (await this.app.vault.adapter.exists(legacyPath)) {
				if (typeof this.app.vault.adapter.remove === 'function') {
					await this.app.vault.adapter.remove(legacyPath);
				}
			}
		} catch {
			// ignore
		}
	}

	// ─── 4. Antigravity (전역 잔여물 안전 청소) ──────────────────────────────

	/**
	 * Antigravity는 agy mcp add 시 시스템 전역(~/.gemini/config/mcp_config.json)에 영구 등록되어
	 * 옵시디언 종료 후 외부 터미널에서 agy 실행 시 연결 실패 오류를 유발하므로 자동 등록(sync)하지 않습니다.
	 * 
	 * 대신 과거에 등록되었거나 남아있을 수 있는 lumina 항목을 완전히 제거(cleanup)합니다.
	 */
	public async cleanupAntigravity(): Promise<void> {
		try {
			const proc = ProcessManager.spawn({
				command: 'agy',
				args: ['mcp', 'remove', 'lumina'],
				cwd: process.cwd(),
				timeoutMs: 5000,
			});

			await proc.waitForExit();
			debugLogger.logSystem('mcp', `[CliMcpSync] Antigravity MCP unregistered via agy mcp remove`);
		} catch {
			// agy 미설치 또는 실패 시 무시
		}
	}
}

