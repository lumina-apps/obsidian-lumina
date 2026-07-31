import { writable } from 'svelte/store';
import { diffLines } from 'diff';
import type { Change } from 'diff';

export interface DiffChunk {
	id: string;
	changes: Change[];
	status: 'pending' | 'accepted' | 'rejected';
}

export type ActionType = 'edit' | 'create_note' | 'delete' | 'rename' | 'frontmatter' | 'attachment' | 'execute' | 'shell' | 'mcp_tool';

export interface ApprovalRequest {
	id: string;
	filePath: string;
	baseContent: string;
	proposedContent: string;
	chunks: DiffChunk[];
	allChanges: EnrichedChange[];
	actionType?: ActionType;
	metadata?: Record<string, unknown>;
	resolve: (result: { approved: boolean; content: string }) => void;
}

export interface ApprovalOptions {
	/** 승인 대기 최대 시간(ms). 0 또는 미지정 시 타임아웃 없음 */
	timeoutMs?: number;
	/** 중단 신호. abort 시 자동 거절 처리 */
	signal?: AbortSignal;
}

export interface EnrichedChange extends Change {
	chunkId?: string;
}

export interface ActionRecord {
	requestId: string;
	chunkId?: string; // if undefined, it means whole file action
	action: 'accept' | 'reject';
	previousState?: unknown;
}

export interface ApprovalState {
	queue: ApprovalRequest[];
	undoStack: ActionRecord[];
}

const initialState: ApprovalState = {
	queue: [],
	undoStack: []
};

export const approvalStore = writable<ApprovalState>(initialState);

function generateId(): string {
	return crypto.randomUUID();
}

/**
 * Parses raw diff changes into logical chunks of modifications separated by unmodified context.
 */
function parseIntoChunks(changes: Change[]): EnrichedChange[] {
	const enriched: EnrichedChange[] = [];
	let currentChunkId: string | undefined = undefined;

	for (const change of changes) {
		if (change.added || change.removed) {
			if (!currentChunkId) {
				currentChunkId = generateId();
			}
			enriched.push({ ...change, chunkId: currentChunkId });
		} else {
			currentChunkId = undefined; // reset chunk
			enriched.push({ ...change });
		}
	}
	return enriched;
}

function createRequestWithAutoResolve<T>(
	build: (resolve: (value: T) => void) => ApprovalRequest | null,
	resolveValue: T,
	options?: ApprovalOptions,
): Promise<T> {
	return new Promise<T>((resolve) => {
		let settled = false;
		let timer: number | null = null;

		const settle = (value: T) => {
			if (settled) return;
			settled = true;
			if (timer !== null) window.clearTimeout(timer);
			if (options?.signal) {
				options.signal.removeEventListener('abort', onAbort);
			}
			resolve(value);
		};

		const onAbort = () => {
			// 사용자가 중단한 경우 자동 거절 처리
			settle(resolveValue);
		};

		if (options?.signal) {
			if (options.signal.aborted) {
				settle(resolveValue);
				return;
			}
			options.signal.addEventListener('abort', onAbort);
		}

		if (options?.timeoutMs && options.timeoutMs > 0) {
			timer = window.setTimeout(() => {
				settle(resolveValue);
			}, options.timeoutMs);
		}

		const request = build((value) => settle(value));
		// build() 내부에서 이미 resolve된 경우(예: diff 없음) 큐에 추가하지 않는다.
		if (request && !settled) {
			approvalStore.update((state) => ({
				queue: [...state.queue, request],
				undoStack: state.undoStack
			}));
		}
	});
}

export const approvalManager = {
	/**
	 * Submits a new modification proposal. Returns a promise that resolves when the user approves/rejects.
	 * options.timeoutMs 또는 options.signal이 주어지면 해당 조건에서 자동 거절 처리된다.
	 */
	requestApproval(
		filePath: string,
		baseContent: string,
		proposedContent: string,
		options?: ApprovalOptions,
	): Promise<{ approved: boolean; content: string }> {
		const REJECTED: { approved: boolean; content: string } = { approved: false, content: '' };

		return createRequestWithAutoResolve(
			(resolve) => {
				const changes = diffLines(baseContent, proposedContent);
				const allChanges = parseIntoChunks(changes);

				// Extract just the chunks for easy UI iteration
				const chunkMap = new Map<string, Change[]>();
				for (const change of allChanges) {
					if (change.chunkId) {
						if (!chunkMap.has(change.chunkId)) {
							chunkMap.set(change.chunkId, []);
						}
						chunkMap.get(change.chunkId)!.push(change);
					}
				}

				const chunks: DiffChunk[] = Array.from(chunkMap.entries()).map(([id, changes]) => ({
					id,
					changes,
					status: 'pending'
				}));

				// If there are no actual differences, just auto-resolve
				if (chunks.length === 0) {
					resolve({ approved: true, content: baseContent });
				}

				return {
					id: generateId(),
					filePath,
					baseContent,
					proposedContent,
					chunks,
					allChanges,
					actionType: 'edit',
					resolve: (result) => resolve(result)
				};
			},
			REJECTED,
			options,
		);
	},

	/**
	 * Submits a new action proposal (delete, rename, execute, etc). Returns a promise that resolves when approved/rejected.
	 * options.timeoutMs 또는 options.signal이 주어지면 해당 조건에서 자동 거절 처리된다.
	 */
	requestActionApproval(
		actionType: Exclude<ActionType, 'edit'>,
		filePath: string,
		metadata: Record<string, unknown> = {},
		options?: ApprovalOptions,
	): Promise<boolean> {
		return createRequestWithAutoResolve(
			(resolve) => ({
				id: generateId(),
				filePath,
				baseContent: '',
				proposedContent: '',
				chunks: [],
				allChanges: [],
				actionType,
				metadata,
				resolve: (result) => resolve(result.approved)
			}),
			false,
			options,
		);
	},

	acceptChunk(requestId: string, chunkId: string) {
		approvalStore.update((state) => {
			const queue = state.queue.map((req) => {
				if (req.id !== requestId) return req;
				return {
					...req,
					chunks: req.chunks.map((c) => 
						c.id === chunkId && c.status === 'pending'
							? { ...c, status: 'accepted' as const }
							: c
					)
				};
			});
			return {
				queue,
				undoStack: [...state.undoStack, { requestId, chunkId, action: 'accept' as const }]
			};
		});
		this.checkCompletion(requestId);
	},

	rejectChunk(requestId: string, chunkId: string) {
		approvalStore.update((state) => {
			const queue = state.queue.map((req) => {
				if (req.id !== requestId) return req;
				return {
					...req,
					chunks: req.chunks.map((c) =>
						c.id === chunkId && c.status === 'pending'
							? { ...c, status: 'rejected' as const }
							: c
					)
				};
			});
			return {
				queue,
				undoStack: [...state.undoStack, { requestId, chunkId, action: 'reject' as const }]
			};
		});
		this.checkCompletion(requestId);
	},

	acceptAll(requestId: string) {
		approvalStore.update((state) => ({
			queue: state.queue.map((req) =>
				req.id === requestId
					? { ...req, chunks: req.chunks.map((c) => c.status === 'pending' ? { ...c, status: 'accepted' as const } : c) }
					: req
			),
			undoStack: [...state.undoStack, { requestId, action: 'accept' as const }]
		}));
		this.checkCompletion(requestId);
	},

	rejectAll(requestId: string) {
		let resolveFn: ((result: { approved: boolean; content: string }) => void) | undefined;
		approvalStore.update((state) => {
			const req = state.queue.find((r) => r.id === requestId);
			if (req) {
				resolveFn = req.resolve;
			}
			return {
				queue: state.queue.filter((r) => r.id !== requestId),
				undoStack: state.undoStack
			};
		});
		
		if (resolveFn) {
			resolveFn({ approved: false, content: '' });
		}
	},

	undo() {
		approvalStore.update((state) => {
			const lastAction = state.undoStack[state.undoStack.length - 1];
			if (!lastAction) return state;
			const newUndoStack = state.undoStack.slice(0, -1);

			if (lastAction.chunkId) {
				return {
					queue: state.queue.map((req) =>
						req.id === lastAction.requestId
							? {
									...req,
									chunks: req.chunks.map((c) =>
										c.id === lastAction.chunkId ? { ...c, status: 'pending' as const } : c
									)
							  }
							: req
					),
					undoStack: newUndoStack
				};
			} else {
				return {
					queue: state.queue.map((req) =>
						req.id === lastAction.requestId
							? { ...req, chunks: req.chunks.map((c) => ({ ...c, status: 'pending' as const })) }
							: req
					),
					undoStack: newUndoStack
				};
			}
		});
	},

	checkCompletion(requestId: string) {
		let isComplete = false;
		let finalContent = '';
		let resolveFn: ((result: { approved: boolean; content: string }) => void) | undefined;
		let baseContent = '';
		let actionType: ActionType | undefined = 'edit';

		approvalStore.update((state) => {
			const reqIndex = state.queue.findIndex((r) => r.id === requestId);
			if (reqIndex !== -1) {
				const req = state.queue[reqIndex];
				isComplete = req.chunks.every((c) => c.status !== 'pending');
				
				if (isComplete) {
					// Build the final content
					finalContent = this.buildFinalContent(req);
					resolveFn = req.resolve;
					baseContent = req.baseContent;
					actionType = req.actionType;
					
					// Remove from queue
					return {
						queue: state.queue.filter((r) => r.id !== requestId),
						undoStack: state.undoStack
					};
				}
			}
			// Return same reference if not complete — Svelte will skip update
			return state;
		});

		if (isComplete && resolveFn) {
			if (actionType === 'edit' && finalContent === baseContent) {
				resolveFn({ approved: false, content: '' });
			} else {
				resolveFn({ approved: true, content: finalContent });
			}
		}
	},

	buildFinalContent(req: ApprovalRequest): string {
		let result = '';
		for (const change of req.allChanges) {
			if (change.chunkId) {
				const chunk = req.chunks.find(c => c.id === change.chunkId);
				if (chunk?.status === 'accepted') {
					if (!change.removed) {
						result += change.value;
					}
				} else if (chunk?.status === 'rejected') {
					if (!change.added) {
						result += change.value;
					}
				} else {
					// Fallback for pending or missing chunks: keep base content
					if (!change.added) {
						result += change.value;
					}
				}
			} else {
				if (!change.removed && !change.added) {
					result += change.value;
				}
			}
		}
		return result;
	}
};
