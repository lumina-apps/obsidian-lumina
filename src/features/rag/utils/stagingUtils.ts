import { TFile } from 'obsidian';
import type LuminaPlugin from '../../../main';
import { estimateTokens } from '../../../shared/utils/tokenEstimator';
import { debugLogger } from '../../../shared/debugLogger';
import { normalizeError } from '../../../shared/utils/errorUtils';

/**
 * 특정 파일 경로에 대해 인덱싱된 상위 청크 텍스트를 기반으로 전체 파일 예상 토큰 수를 계산합니다.
 * 인덱스에 존재하지 않는 경우 vault.cachedRead()로 직접 읽어 토큰을 추정합니다.
 */
export async function estimateFileTokens(plugin: LuminaPlugin, path: string): Promise<number> {
	try {
		const parentChunks = plugin.indexer?.indexedParentChunks?.filter(c => c.path === path) ?? [];
		if (parentChunks.length > 0) {
			const combinedText = parentChunks.map(c => c.text).join('\n');
			return estimateTokens(combinedText);
		}

		const abstractFile = plugin.app.vault.getAbstractFileByPath(path);
		if (abstractFile instanceof TFile) {
			const content = await plugin.app.vault.cachedRead(abstractFile);
			return estimateTokens(content);
		}
	} catch (err) {
		debugLogger.logWarn('rag', `토큰 추정 실패 (${path}): ${normalizeError(err, String(err)).message}`);
	}
	return 0;
}
