/**
 * errorUtils.ts
 *
 * 에러 정규화 및 처리를 위한 공통 유틸리티.
 */

/**
 * unknown 타입의 에러를 Error 객체로 정규화합니다.
 * debugLogger.logError 등의 호출부에서 반복되는 instanceof 체크를 제거하기 위함.
 */
export function normalizeError(err: unknown, fallbackMessage: string = '알 수 없는 오류'): Error {
	if (err instanceof Error) return err;
	return new Error(typeof err === 'string' ? err : fallbackMessage);
}