import type { DebugLogType } from '../../../shared/types/debug.types';
import { TYPE_LABEL_MAP } from '../constants';

/**
 * 타임스탬프를 HH:mm:ss 형식으로 포맷합니다.
 */
export function formatTime(ts: number): string {
	return new Date(ts).toLocaleTimeString('ko-KR', { hour12: false });
}

/**
 * 밀리초를 사람이 읽기 쉬운 형태로 포맷합니다.
 * - 1000ms 미만: "XXXms"
 * - 1000ms 이상: "X.Xs"
 */
export function formatDuration(ms: number): string {
	return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/**
 * 문자열이 max를 초과하면 잘라내고 말줄임표(…)를 추가합니다.
 */
export function truncate(str: string, max = 120): string {
	return str.length <= max ? str : str.slice(0, max) + '…';
}

/**
 * 로그 타입에 해당하는 표시용 레이블을 반환합니다.
 * 매핑되지 않은 타입은 대문자로 변환하여 반환합니다.
 */
export function typeLabel(type: string): string {
	return TYPE_LABEL_MAP[type as DebugLogType] ?? type.toUpperCase();
}