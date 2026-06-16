import type LuminaPlugin from '../../../main';
import { isExcluded, isIncluded } from '../../../features/rag/exclusions';

/**
 * 경로 접근 제어 및 쓰기 잠금 관리.
 * luminaMcpServer.ts에서 분리된 책임입니다.
 */
export class PathGuard {
	private writeLocks = new Set<string>();

	/**
	 * RAG 제외/포함 설정을 기반으로 에이전트 접근이 허용된 경로인지 확인합니다.
	 * agentRespectRagExclusions이 false이면 모든 경로 허용.
	 */
	isAgentPathAllowed(filePath: string, plugin: LuminaPlugin): boolean {
		const mcpSettings = plugin.settings.mcp;
		if (!mcpSettings.agentRespectRagExclusions) {
			return true;
		}
		const ragSettings = plugin.settings.rag;
		if (!isIncluded(filePath, ragSettings.includedPaths)) {
			return false;
		}
		if (isExcluded(filePath, ragSettings.excludedPaths)) {
			return false;
		}
		return true;
	}

	/**
	 * 파일 경로에 대한 쓰기 잠금을 획득하고 작업을 실행합니다.
	 * 동일 경로에 대한 동시 수정을 방지합니다.
	 */
	async lock<T>(path: string, fn: () => Promise<T>): Promise<T> {
		if (this.writeLocks.has(path)) {
			throw new Error(`File ${path} is currently being modified by another operation.`);
		}
		this.writeLocks.add(path);
		try {
			return await fn();
		} finally {
			this.writeLocks.delete(path);
		}
	}
}