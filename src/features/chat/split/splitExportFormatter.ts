import { t } from '../../../shared/locales/helpers';
import { sanitizeDisplayContent } from '../../../shared/utils/llmTextSanitizer';
import type {
	SplitChatSession,
	SplitSlotConfig,
	SplitTurn,
} from '../../../shared/types/splitChat.types';

/** 비교 리포트 직렬화 옵션 */
export interface SplitExportFormatOptions {
	/** Blind 모드에서 아직 미공개된 턴의 모델명을 강제로 노출할지 여부 (기본: false) */
	includeHiddenModels?: boolean;
}

/** 마크다운 테이블 셀 내 파이프 및 줄바꿈 이스케이프 */
function escapeTableCell(value: string): string {
	return value.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

/** 특정 턴에서 슬롯의 표시 이름 결정 (미공개 Blind 턴이면 모델명 마스킹) */
function resolveSlotDisplayName(
	slot: SplitSlotConfig | undefined,
	slotId: string,
	modelId: string,
	turn: SplitTurn,
	revealHidden: boolean,
): string {
	const label = slot?.label ?? '?';
	if (turn.isRevealed || revealHidden) {
		return modelId ? `${label} · ${modelId}` : `${label} (${slotId})`;
	}
	return t('splitChat.blindModelLabel', { label });
}

/** 승자 선택 값을 사람이 읽을 수 있는 문자열로 포맷 */
function formatWinnerLabel(
	turn: SplitTurn,
	slotMap: Map<string, SplitSlotConfig>,
	revealHidden: boolean,
): string | null {
	const choice = turn.winnerSlotId;
	if (!choice) return null;
	if (choice === 'tie') return t('splitChat.voteTie');
	if (choice === 'both_bad') return t('splitChat.voteBothBad');

	const resp = turn.responses[choice];
	const slot = slotMap.get(choice);
	const modelId = resp?.modelId ?? slot?.modelId ?? '';
	return resolveSlotDisplayName(slot, choice, modelId, turn, revealHidden);
}

/**
 * Split 비교 세션을 사람이 읽기 쉬운 마크다운 비교 리포트로 포맷합니다.
 */
export function formatSplitComparisonMarkdown(
	session: SplitChatSession,
	options?: SplitExportFormatOptions,
): string {
	const revealHidden = options?.includeHiddenModels ?? false;
	const hasUnrevealedTurns =
		session.mode === 'blind' && session.turns.some((turn) => !turn.isRevealed);
	const hideSummaryModels = hasUnrevealedTurns && !revealHidden;

	const slotMap = new Map<string, SplitSlotConfig>(
		session.slots.map((slot) => [slot.slotId, slot]),
	);

	const modeText =
		session.mode === 'blind'
			? t('splitChat.modeBlind')
			: t('splitChat.modeSideBySide');
	const contextText =
		session.contextMode === 'winner'
			? t('splitChat.contextWinner')
			: t('splitChat.contextIndependent');

	const modelSummaryList = session.slots
		.map((s) =>
			hideSummaryModels
				? t('splitChat.blindModelLabel', { label: s.label })
				: `${s.label} (${s.modelId})`,
		)
		.join(', ');

	const headerLines = [
		`# ${session.title || t('splitChat.title')}`,
		'',
		`- **${t('splitChat.exportReportMode')}**: ${modeText}`,
		`- **${t('splitChat.exportReportContext')}**: ${contextText}`,
		`- **${t('splitChat.exportReportModels')}**: ${modelSummaryList}`,
		`- **Date**: ${new Date(session.createdAt).toLocaleString()}`,
		'',
	];

	// ── 모델별 통계 요약 테이블 ──────────────────────────────────────────────
	const summaryLines: string[] = [
		`## ${t('splitChat.exportReportSummary')}`,
		'',
		`| Slot | ${t('splitChat.exportReportModels')} | ${t('splitChat.exportReportWins')} | ${t('splitChat.exportReportAvgTime')} | ${t('splitChat.exportReportTotalTokens')} |`,
		'| --- | --- | ---: | ---: | ---: |',
	];

	for (const slot of session.slots) {
		let wins = 0;
		let durationSum = 0;
		let durationCount = 0;
		let totalTokens = 0;

		for (const turn of session.turns) {
			if (turn.winnerSlotId === slot.slotId) {
				wins += 1;
			}
			const resp = turn.responses[slot.slotId];
			if (resp) {
				if (typeof resp.metrics?.durationMs === 'number') {
					durationSum += resp.metrics.durationMs;
					durationCount += 1;
				}
				if (resp.tokenUsage) {
					totalTokens += resp.tokenUsage.totalTokens;
				}
			}
		}

		const modelCell = hideSummaryModels
			? t('splitChat.blindHidden')
			: escapeTableCell(slot.modelId);
		const avgTimeCell =
			durationCount > 0
				? `${(durationSum / durationCount / 1000).toFixed(2)}s`
				: '-';
		const tokensCell = totalTokens > 0 ? totalTokens.toLocaleString() : '-';

		summaryLines.push(
			`| ${escapeTableCell(slot.label)} | ${modelCell} | ${wins} | ${avgTimeCell} | ${tokensCell} |`,
		);
	}

	summaryLines.push('');

	// ── 라운드별 상세 비교 내용 ──────────────────────────────────────────────
	const turnBlocks: string[] = [];

	session.turns.forEach((turn, idx) => {
		const roundLines: string[] = [
			'---',
			'',
			`## ${t('splitChat.exportReportRound', { num: idx + 1 })}`,
			'',
			`### 👤 ${t('splitChat.exportReportPrompt')}`,
			'',
			turn.userMessage.content || '',
		];

		if (turn.userMessage.attachments && turn.userMessage.attachments.length > 0) {
			const attList = turn.userMessage.attachments
				.map((a) => (a.path ? `[[${a.path}|${a.name}]]` : `[[${a.name}]]`))
				.join(', ');
			roundLines.push('', `📎 **Attachments**: ${attList}`);
		}

		if (turn.ragSources && turn.ragSources.length > 0) {
			const sourceList = Array.from(
				new Set(turn.ragSources.map((s) => `[[${s.filePath}]]`)),
			).join(', ');
			roundLines.push('', `📚 **Sources**: ${sourceList}`);
		}

		const winnerLabel = formatWinnerLabel(turn, slotMap, revealHidden);
		if (winnerLabel) {
			roundLines.push('', `> 🏆 **${t('splitChat.exportReportResult')}**: ${winnerLabel}`);
		}

		roundLines.push('');

		const orderedSlotIds =
			turn.blindOrder && turn.blindOrder.length > 0 && !turn.isRevealed && !revealHidden
				? turn.blindOrder
				: [
						...session.slots.map((s) => s.slotId),
						...Object.keys(turn.responses).filter(
							(sid) => !session.slots.some((s) => s.slotId === sid),
						),
					];

		for (const sid of orderedSlotIds) {
			const resp = turn.responses[sid];
			if (!resp) continue;

			const slot = slotMap.get(sid);
			const headingName = resolveSlotDisplayName(
				slot,
				sid,
				resp.modelId,
				turn,
				revealHidden,
			);
			const isWinner = turn.winnerSlotId === sid;
			const winnerSuffix = isWinner ? ` 🏆` : '';

			const metricParts: string[] = [];
			if (typeof resp.metrics?.durationMs === 'number') {
				metricParts.push(`${(resp.metrics.durationMs / 1000).toFixed(2)}s`);
			}
			if (resp.tokenUsage) {
				metricParts.push(`${resp.tokenUsage.totalTokens.toLocaleString()} tok`);
			}
			if (typeof resp.metrics?.tokensPerSecond === 'number') {
				metricParts.push(`${resp.metrics.tokensPerSecond} t/s`);
			}

			roundLines.push(`#### ${headingName}${winnerSuffix}`);
			if (metricParts.length > 0) {
				roundLines.push(`*${metricParts.join(' · ')}*`);
			}
			roundLines.push('');

			if (resp.status === 'error') {
				roundLines.push(`> ⚠️ ${t('common.error')}: ${resp.errorMessage || ''}`);
			} else if (resp.status === 'aborted' && !resp.content.trim()) {
				roundLines.push(`*${t('splitChat.aborted')}*`);
			} else {
				const cleanContent = sanitizeDisplayContent(resp.content);
				roundLines.push(cleanContent || '*—*');
			}
			roundLines.push('');
		}

		turnBlocks.push(roundLines.join('\n'));
	});

	return [...headerLines, ...summaryLines, ...turnBlocks].join('\n');
}
