/**
 * requestId 기반 pending Promise 관리.
 * 워커 통신에서 requestId → {resolve, reject} 맵을 제네릭하게 관리합니다.
 */

interface PendingEntry<T> {
	resolve: (data: T) => void;
	reject: (err: Error) => void;
}

export class PendingRequestManager<T> {
	private pending = new Map<string, PendingEntry<T>>();

	add(requestId: string, resolve: (data: T) => void, reject: (err: Error) => void): void {
		this.pending.set(requestId, { resolve, reject });
	}

	resolve(requestId: string, data: T): boolean {
		const entry = this.pending.get(requestId);
		if (entry) {
			entry.resolve(data);
			this.pending.delete(requestId);
			return true;
		}
		return false;
	}

	reject(requestId: string, err: Error): boolean {
		const entry = this.pending.get(requestId);
		if (entry) {
			entry.reject(err);
			this.pending.delete(requestId);
			return true;
		}
		return false;
	}

	rejectAll(err: Error): void {
		for (const [, entry] of this.pending) {
			entry.reject(err);
		}
		this.pending.clear();
	}
}
