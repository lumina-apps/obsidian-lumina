/** unknown 에러를 Error 객체로 정규화 */
export function normalizeError(err: unknown, fallbackMessage?: string): Error {
	if (err instanceof Error) return err;
	if (fallbackMessage !== undefined) return new Error(fallbackMessage);
	return new Error(typeof err === 'string' ? err : '알 수 없는 오류');
}
