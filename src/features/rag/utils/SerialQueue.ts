/**
 * SerialQueue.ts
 *
 * 입력 항목을 FIFO 순서로 직렬화하여 비동기 처리하는 제네릭 큐.
 * 한 번에 하나의 항목만 처리되며, enqueue된 순서대로 실행됩니다.
 */

type Processor<TIn, TOut> = (item: TIn) => Promise<TOut>;

interface QueueEntry<TIn, TOut> {
	item: TIn;
	resolve: (result: TOut) => void;
	reject: (err: Error) => void;
}

export class SerialQueue<TIn, TOut> {
	private queue: Array<QueueEntry<TIn, TOut>> = [];
	private isProcessing = false;

	constructor(private processor: Processor<TIn, TOut>) {}

	/** 항목을 큐에 추가하고, 처리가 완료되면 resolve되는 Promise 반환 */
	enqueue(item: TIn): Promise<TOut> {
		return new Promise<TOut>((resolve, reject) => {
			this.queue.push({ item, resolve, reject });
			void this.processQueue();
		});
	}

	private async processQueue(): Promise<void> {
		if (this.isProcessing || this.queue.length === 0) return;
		this.isProcessing = true;

		try {
			while (this.queue.length > 0) {
				const entry = this.queue.shift()!;
				try {
					const result = await this.processor(entry.item);
					entry.resolve(result);
				} catch (err) {
					entry.reject(err instanceof Error ? err : new Error(String(err)));
				}
			}
		} finally {
			this.isProcessing = false;
		}
	}
}