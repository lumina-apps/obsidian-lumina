import { writable } from 'svelte/store';
import { diffLines } from 'diff';
import type { Change } from 'diff';

export interface DiffChunk {
	id: string;
	changes: Change[];
	status: 'pending' | 'accepted' | 'rejected';
}

export type ActionType = 'edit' | 'create_note' | 'delete' | 'rename' | 'frontmatter' | 'attachment' | 'execute';

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

export const approvalManager = {
	/**
	 * Submits a new modification proposal. Returns a promise that resolves when the user approves/rejects.
	 */
	requestApproval(filePath: string, baseContent: string, proposedContent: string): Promise<{ approved: boolean; content: string }> {
		return new Promise((resolve) => {
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
				return;
			}

			const request: ApprovalRequest = {
				id: generateId(),
				filePath,
				baseContent,
				proposedContent,
				chunks,
				allChanges,
				actionType: 'edit',
				resolve
			};

			approvalStore.update((state) => {
				state.queue.push(request);
				return state;
			});
		});
	},

	/**
	 * Submits a new action proposal (delete, rename, execute, etc). Returns a promise that resolves when approved/rejected.
	 */
	requestActionApproval(
		actionType: 'create_note' | 'delete' | 'rename' | 'frontmatter' | 'attachment' | 'execute',
		filePath: string,
		metadata: Record<string, unknown> = {}
	): Promise<boolean> {
		return new Promise((resolve) => {
			const request: ApprovalRequest = {
				id: generateId(),
				filePath,
				baseContent: '',
				proposedContent: '',
				chunks: [],
				allChanges: [],
				actionType,
				metadata,
				resolve: (result) => resolve(result.approved)
			};

			approvalStore.update((state) => {
				state.queue.push(request);
				return state;
			});
		});
	},

	acceptChunk(requestId: string, chunkId: string) {
		approvalStore.update((state) => {
			const req = state.queue.find((r) => r.id === requestId);
			if (req) {
				const chunk = req.chunks.find((c) => c.id === chunkId);
				if (chunk && chunk.status === 'pending') {
					chunk.status = 'accepted';
					state.undoStack.push({ requestId, chunkId, action: 'accept' });
				}
			}
			return state;
		});
		this.checkCompletion(requestId);
	},

	rejectChunk(requestId: string, chunkId: string) {
		approvalStore.update((state) => {
			const req = state.queue.find((r) => r.id === requestId);
			if (req) {
				const chunk = req.chunks.find((c) => c.id === chunkId);
				if (chunk && chunk.status === 'pending') {
					chunk.status = 'rejected';
					state.undoStack.push({ requestId, chunkId, action: 'reject' });
				}
			}
			return state;
		});
		this.checkCompletion(requestId);
	},

	acceptAll(requestId: string) {
		approvalStore.update((state) => {
			const req = state.queue.find((r) => r.id === requestId);
			if (req) {
				req.chunks.forEach((chunk) => {
					if (chunk.status === 'pending') {
						chunk.status = 'accepted';
					}
				});
				state.undoStack.push({ requestId, action: 'accept' });
			}
			return state;
		});
		this.checkCompletion(requestId);
	},

	rejectAll(requestId: string) {
		let resolveFn: ((result: { approved: boolean; content: string }) => void) | undefined;
		approvalStore.update((state) => {
			const req = state.queue.find((r) => r.id === requestId);
			if (req) {
				resolveFn = req.resolve;
				state.queue = state.queue.filter((r) => r.id !== requestId);
			}
			return state;
		});
		
		if (resolveFn) {
			resolveFn({ approved: false, content: '' });
		}
	},

	undo() {
		approvalStore.update((state) => {
			const lastAction = state.undoStack.pop();
			if (!lastAction) return state;

			const req = state.queue.find((r) => r.id === lastAction.requestId);
			if (!req) return state;

			if (lastAction.chunkId) {
				const chunk = req.chunks.find((c) => c.id === lastAction.chunkId);
				if (chunk) {
					chunk.status = 'pending';
				}
			} else {
				// Undo full accept
				req.chunks.forEach((chunk) => {
					chunk.status = 'pending';
				});
			}

			return state;
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
					state.queue.splice(reqIndex, 1);
				}
			}
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
