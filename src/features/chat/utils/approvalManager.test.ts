import { describe, it, expect, beforeEach } from 'vitest';
import { approvalManager, approvalStore, type ApprovalRequest } from './approvalManager';

describe('approvalManager', () => {
	beforeEach(() => {
		approvalStore.set({ queue: [], undoStack: [] });
	});

	it('should auto-resolve when contents differ only by CRLF vs LF', async () => {
		const baseContent = 'line 1\r\nline 2\r\nline 3';
		const proposedContent = 'line 1\nline 2\nline 3';

		const result = await approvalManager.requestApproval('test.md', baseContent, proposedContent);

		expect(result.approved).toBe(true);
		expect(result.content).toBe(baseContent);
	});

	it('should queue approval request with normalized diff when content actually changes', async () => {
		const baseContent = 'line 1\r\nline 2\r\nline 3';
		const proposedContent = 'line 1\nmodified line 2\nline 3';

		const promise = approvalManager.requestApproval('test.md', baseContent, proposedContent);

		let queuedRequest: ApprovalRequest | undefined;
		const unsubscribe = approvalStore.subscribe((state) => {
			if (state.queue.length > 0) {
				queuedRequest = state.queue[0];
			}
		});

		expect(queuedRequest).toBeDefined();
		if (!queuedRequest) throw new Error('queuedRequest is undefined');
		expect(queuedRequest.filePath).toBe('test.md');
		// Should only have diff for modified line 2, not all lines
		expect(queuedRequest.chunks.length).toBe(1);

		approvalManager.acceptAll(queuedRequest.id);
		const result = await promise;
		expect(result.approved).toBe(true);
		expect(result.content).toContain('modified line 2');
		unsubscribe();
	});

	it('should calculate accurate startLine and detect isTable for chunks', async () => {
		const baseContent = [
			'line 1',
			'line 2',
			'target 1',
			'line 4',
			'| col 1 | col 2 |',
			'| --- | --- |',
			'| target 2 in table | desc |',
			'line 8',
		].join('\n');

		const proposedContent = baseContent
			.replace('target 1', 'replacement 1')
			.replace('target 2 in table', 'replacement 2 in table');

		void approvalManager.requestApproval('test-table.md', baseContent, proposedContent);

		let queuedRequest: ApprovalRequest | undefined;
		const unsubscribe = approvalStore.subscribe((state) => {
			if (state.queue.length > 0) {
				queuedRequest = state.queue.find((r) => r.filePath === 'test-table.md');
			}
		});

		expect(queuedRequest).toBeDefined();
		if (!queuedRequest) throw new Error('queuedRequest is undefined');

		expect(queuedRequest.chunks.length).toBe(2);
		// Chunk 1: target 1 is on line 3
		expect(queuedRequest.chunks[0].startLine).toBe(3);
		expect(queuedRequest.chunks[0].isTable).toBe(false);

		// Chunk 2: target 2 is on line 7 and is in a table
		expect(queuedRequest.chunks[1].startLine).toBe(7);
		expect(queuedRequest.chunks[1].isTable).toBe(true);

		approvalManager.rejectAll(queuedRequest.id);
		unsubscribe();
	});
});
