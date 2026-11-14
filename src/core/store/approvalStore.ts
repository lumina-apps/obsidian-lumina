import { writable } from 'svelte/store';
import { diffLines } from 'diff';
import type { Change } from 'diff';
import { debugLogger } from '../../shared/debugLogger';

export interface DiffChunk {
	id: string;
	changes: Change[];
	status: 'pending' | 'accepted' | 'rejected';
	startLine?: number;
	isTable?: boolean;
}

export type ActionType = 'edit' | 'create_note' | 'delete' | 'rename' | 'frontmatter' | 'attachment' | 'shell' | 'mcp_tool';

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
 * 변경 사항을 수정되지 않은 컨텍스트 기준으로 논리적 Diff 청크로 분리합니다.
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
	build: (resolve: (value: T, reason?: string) => void) => ApprovalRequest | null,
	resolveValue: T,
	options?: ApprovalOptions,
): Promise<T> {
	return new Promise<T>((resolve) => {
		let settled = false;
		let timer: number | null = null;
		let requestId: string | null = null;
		let actionLabel = 'unknown';
		let targetPath = '';

		const settle = (value: T, reason: string = 'user') => {
			if (settled) return;
			settled = true;
			if (timer !== null) window.clearTimeout(timer);
			if (options?.signal) {
				options.signal.removeEventListener('abort', onAbort);
			}
			if (requestId) {
				approvalStore.update((state) => ({
					queue: state.queue.filter((r) => r.id !== requestId),
					undoStack: state.undoStack,
				}));
			}
			const isApproved =
				typeof value === 'boolean'
					? value
					: typeof value === 'object' && value !== null && 'approved' in value
						? Boolean((value as { approved?: unknown }).approved)
						: false;
			debugLogger.logSystem(
				'approval',
				`Approval resolved: ${actionLabel} on "${targetPath}" -> ${isApproved ? 'approved' : 'rejected'} (reason=${reason})`,
				{ requestId, actionType: actionLabel, filePath: targetPath, approved: isApproved, reason },
			);
			resolve(value);
		};

		const onAbort = () => {
			// 사용자가 중단한 경우 자동 거절 처리
			settle(resolveValue, 'aborted');
		};

		if (options?.signal) {
			if (options.signal.aborted) {
				settle(resolveValue, 'aborted');
				return;
			}
			options.signal.addEventListener('abort', onAbort);
		}

		if (options?.timeoutMs && options.timeoutMs > 0) {
			timer = window.setTimeout(() => {
				settle(resolveValue, 'timeout');
			}, options.timeoutMs);
		}

		const request = build((value, reason) => settle(value, reason ?? 'user'));
		if (request) {
			actionLabel = request.actionType ?? 'edit';
			targetPath = request.filePath;
		}
		// build() 내부에서 이미 resolve된 경우(예: diff 없음) 큐에 추가하지 않는다.
		if (request && !settled) {
			requestId = request.id;
			debugLogger.logSystem(
				'approval',
				`Approval requested: ${actionLabel} on "${request.filePath}" (chunks=${request.chunks.length})`,
				{ requestId: request.id, actionType: actionLabel, filePath: request.filePath, chunksCount: request.chunks.length },
			);
			approvalStore.update((state) => ({
				queue: [...state.queue, request],
				undoStack: state.undoStack
			}));
		}
	});
}

export const approvalManager = {
	/**
	 * 파일 수정 승인 요청을 등록하고 사용자 응답을 반환합니다.
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
				// 원본 파일과 제안된 내용의 줄바꿈 스타일(\r\n vs \n) 통일하여 Diff 왜곡 방지
				let normalizedProposed = proposedContent;
				if (baseContent.includes('\r\n') && !proposedContent.includes('\r\n')) {
					normalizedProposed = proposedContent.replace(/\n/g, '\r\n');
				} else if (!baseContent.includes('\r\n') && proposedContent.includes('\r\n')) {
					normalizedProposed = proposedContent.replace(/\r\n/g, '\n');
				}

				const changes = diffLines(baseContent, normalizedProposed);
				const allChanges = parseIntoChunks(changes);

				// Extract just the chunks for easy UI iteration with startLine and isTable metadata
				let currentLine = 1;
				const chunkMap = new Map<string, { changes: Change[]; startLine: number; isTable: boolean }>();
				for (const change of allChanges) {
					const lines = change.value.split('\n');
					const count = change.count !== undefined
						? change.count
						: (change.value.endsWith('\n') ? lines.length - 1 : lines.length);

					if (change.chunkId) {
						if (!chunkMap.has(change.chunkId)) {
							chunkMap.set(change.chunkId, {
								changes: [],
								startLine: currentLine,
								isTable: false
							});
						}
						const chunkData = chunkMap.get(change.chunkId)!;
						chunkData.changes.push(change);
						if (change.value.includes('|')) {
							chunkData.isTable = true;
						}
						if (change.removed) {
							currentLine += count;
						}
					} else {
						currentLine += count;
					}
				}

				const chunks: DiffChunk[] = Array.from(chunkMap.entries()).map(([id, data]) => ({
					id,
					changes: data.changes,
					status: 'pending',
					startLine: data.startLine,
					isTable: data.isTable
				}));

				// If there are no actual differences, just auto-resolve
				if (chunks.length === 0) {
					resolve({ approved: true, content: baseContent }, 'no_diff');
				}

				return {
					id: generateId(),
					filePath,
					baseContent,
					proposedContent: normalizedProposed,
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
	 * 단일 액션(삭제, 이름 변경, 셸 실행 등)에 대한 승인 요청을 등록합니다.
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
