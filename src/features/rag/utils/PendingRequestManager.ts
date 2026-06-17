/**
 * PendingRequestManager.ts
 *
 * requestId 기반의 pending Promise 매니저.
 * 워커와의 비동기 통신에서 requestId → {resolve, reject} 맵을 제네릭하게 관리합니다.
 */

interface PendingEntry<T> {
	resolve: (data: T) => void;
	reject: (err: Error) => void;
}

export class PendingRequestManager<T> {
	private pending = new Map<string, PendingEntry<T>>();

	/** 새 요청 등록 */
	add(requestId: string, resolve: (data: T) => void, reject: (err: Error) => void): void {
		this.pending.set(requestId, { resolve, reject });
	}

	/** 요청 성공 → resolve 호출 + 맵에서 제거. 반환값: 성공 여부 */
	resolve(requestId: string, data: T): boolean {
		const entry = this.pending.get(requestId);
		if (entry) {
			entry.resolve(data);
			this.pending.delete(requestId);
			return true;
		}
		return false;
	}

	/** 요청 실패 → reject 호출 + 맵에서 제거. 반환값: 성공 여부 */
	reject(requestId: string, err: Error): boolean {
		const entry = this.pending.get(requestId);
		if (entry) {
			entry.reject(err);
			this.pending.delete(requestId);
			return true;
		}
		return false;
	}

	/** 모든 pending 요청을 일괄 reject */
	rejectAll(err: Error): void {
		for (const [, entry] of this.pending) {
			entry.reject(err);
		}
		this.pending.clear();
	}
}