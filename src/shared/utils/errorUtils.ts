/** unknown 에러를 Error 객체로 정규화 */
export function normalizeError(err: unknown, fallbackMessage: string = '알 수 없는 오류'): Error {
	if (err instanceof Error) return err;
	return new Error(typeof err === 'string' ? err : fallbackMessage);
}
