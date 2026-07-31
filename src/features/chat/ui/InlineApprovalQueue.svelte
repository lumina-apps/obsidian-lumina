<script lang="ts">
	import { approvalStore, approvalManager } from "../utils/approvalManager";
	import type { ApprovalRequest } from "../utils/approvalManager";

	// We receive tStore as a prop or context.
	let { tStore } = $props<{ tStore: any }>();

	function accept(id: string) {
		approvalManager.acceptAll(id);
	}

	function reject(id: string) {
		approvalManager.rejectAll(id);
	}

	function acceptChunk(requestId: string, chunkId: string) {
		approvalManager.acceptChunk(requestId, chunkId);
	}

	function rejectChunk(requestId: string, chunkId: string) {
		approvalManager.rejectChunk(requestId, chunkId);
	}

	function getActionTitle(req: ApprovalRequest): string {
		if (req.actionType === 'edit') return $tStore("uiMessages.actionApproval.editNote") || `Edit Note`;
		if (req.actionType === 'mcp_tool') return $tStore("uiMessages.actionApproval.mcpTool") || `MCP Tool: ${req.metadata?.toolName || 'Unknown'}`;
		return $tStore("uiMessages.actionApproval.title", { action: req.actionType?.toUpperCase() || "" }) || `Approval Required: ${req.actionType}`;
	}

	function getActionDescription(req: ApprovalRequest): string {
		if (req.actionType === 'edit') return $tStore("uiMessages.actionApproval.editNoteDesc") || "Review the diff below and accept or reject changes.";
		if (req.actionType === 'create_note') return $tStore("uiMessages.actionApproval.createNote") || "Create note";
		if (req.actionType === 'delete') return $tStore("uiMessages.actionApproval.deleteNote") || "Delete note";
		if (req.actionType === 'rename') return $tStore("uiMessages.actionApproval.renameNote") || "Rename note";
		if (req.actionType === 'frontmatter') return $tStore("uiMessages.actionApproval.updateFrontmatter") || "Update frontmatter";
		if (req.actionType === 'attachment') return $tStore("uiMessages.actionApproval.saveAttachment", { size: req.metadata?.sizeBytes?.toString() || '0' }) || "Save attachment";
		if (req.actionType === 'execute') return $tStore("uiMessages.actionApproval.executeCode") || "Execute code";
		if (req.actionType === 'shell') return $tStore("uiMessages.actionApproval.shellCommand") || "Execute shell command";
		if (req.actionType === 'mcp_tool') return $tStore("uiMessages.actionApproval.mcpToolDesc") || "The agent wants to use an external tool.";
		return "Unknown action";
	}

	function hasAnyChunkDecided(req: ApprovalRequest): boolean {
		return req.chunks.some(c => c.status !== 'pending');
	}

	function allChunksDecided(req: ApprovalRequest): boolean {
		return req.chunks.length > 0 && req.chunks.every(c => c.status !== 'pending');
	}
</script>

<div class="lumina-inline-approvals">
	{#each $approvalStore.queue as req (req.id)}
		{#if req.actionType === 'edit'}
			<!-- Edit diff card -->
			<div class="lumina-inline-approval-card">
				<div class="lumina-inline-approval-header">
					<span class="lumina-inline-approval-title">
						{$tStore("uiMessages.actionApproval.editNote") || "Edit Note"}
						{#if hasAnyChunkDecided(req)}
							<span class="lumina-inline-approval-badge-progress">
								{req.chunks.filter(c => c.status !== 'pending').length}/{req.chunks.length}
							</span>
						{/if}
					</span>
					<span class="lumina-inline-approval-path">{req.filePath}</span>
				</div>
				<div class="lumina-inline-approval-body">
				<div class="lumina-diff-container">
					{#each req.chunks as chunk (chunk.id)}
						{#if chunk.status === 'pending'}
							<div class="lumina-diff-chunk">
								<div class="lumina-diff-chunk-lines">
									{#each chunk.changes as change}
										<div
											class="lumina-diff-line"
											class:lumina-diff-line--added={change.added}
											class:lumina-diff-line--removed={change.removed}
										>
											<span class="lumina-diff-line-marker">{change.added ? '+' : change.removed ? '-' : ' '}</span>
											<span class="lumina-diff-line-text">{change.value}</span>
										</div>
									{/each}
								</div>
								<div class="lumina-diff-chunk-actions">
									<button
										class="lumina-inline-approval-btn-reject-chunk"
										onclick={() => rejectChunk(req.id, chunk.id)}
									>
										{$tStore("uiMessages.actionApproval.reject") || "Reject"}
									</button>
									<button
										class="lumina-inline-approval-btn-accept-chunk"
										onclick={() => acceptChunk(req.id, chunk.id)}
									>
										{$tStore("uiMessages.actionApproval.accept") || "Accept"}
									</button>
								</div>
							</div>
						{/if}
					{/each}
					</div>
				</div>
				<div class="lumina-inline-approval-footer">
					<button
						class="lumina-inline-approval-btn-reject"
						disabled={allChunksDecided(req)}
						onclick={() => reject(req.id)}
					>
						{$tStore("uiMessages.actionApproval.rejectAll") || "Reject All"}
					</button>
					{#if hasAnyChunkDecided(req) && !allChunksDecided(req)}
						<span class="lumina-inline-approval-progress-text">
							{req.chunks.filter(c => c.status !== 'pending').length}/{req.chunks.length}
						</span>
					{/if}
					<button
						class="mod-cta"
						disabled={allChunksDecided(req)}
						onclick={() => accept(req.id)}
					>
						{$tStore("uiMessages.actionApproval.acceptAll") || "Accept All"}
					</button>
				</div>
			</div>
		{:else}
			<div class="lumina-inline-approval-card">
				<div class="lumina-inline-approval-header">
					<span class="lumina-inline-approval-title">{getActionTitle(req)}</span>
					<span class="lumina-inline-approval-path">{req.filePath}</span>
				</div>
				<div class="lumina-inline-approval-body">
					<p>{getActionDescription(req)}</p>

					{#if req.actionType === 'create_note' && req.metadata?.content}
						<pre class="lumina-inline-approval-code">{req.metadata.content}</pre>
					{/if}

					{#if req.actionType === 'rename' && req.metadata?.targetPath}
						<p><strong>{req.metadata.targetPath}</strong></p>
					{/if}

					{#if req.actionType === 'frontmatter'}
						<p><strong>{req.metadata?.key} &rarr; {req.metadata?.value}</strong></p>
					{/if}

					{#if req.actionType === 'execute' && req.metadata?.code}
						<pre class="lumina-inline-approval-code">{req.metadata.code}</pre>
					{/if}

					{#if req.actionType === 'shell' && req.metadata?.code}
						<pre class="lumina-inline-approval-code lumina-inline-approval-code--danger">{req.metadata.code}</pre>
					{/if}

					{#if req.actionType === 'mcp_tool' && req.metadata?.args}
						<pre class="lumina-inline-approval-code">{JSON.stringify(req.metadata.args, null, 2)}</pre>
					{/if}
				</div>
				<div class="lumina-inline-approval-footer">
					<button class="lumina-inline-approval-btn-reject" onclick={() => reject(req.id)}>
						{$tStore("uiMessages.actionApproval.reject") || "Reject"}
					</button>
					<button class="mod-cta" onclick={() => accept(req.id)}>
						{$tStore("uiMessages.actionApproval.accept") || "Accept"}
					</button>
				</div>
			</div>
		{/if}
	{/each}
</div>

<style>
	.lumina-inline-approvals {
		display: flex;
		flex-direction: column;
		gap: 8px;
		padding: 8px 16px;
		max-height: 50vh;
		overflow-y: auto;
	}
	.lumina-inline-approval-card {
		background: var(--background-secondary);
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-m);
		padding: 12px;
		display: flex;
		flex-direction: column;
		gap: 8px;
	}
	.lumina-inline-approval-header {
		display: flex;
		justify-content: space-between;
		align-items: center;
		border-bottom: 1px solid var(--background-modifier-border);
		padding-bottom: 4px;
	}
	.lumina-inline-approval-title {
		font-weight: bold;
		color: var(--text-normal);
		display: flex;
		align-items: center;
		gap: 8px;
	}
	.lumina-inline-approval-path {
		font-size: var(--font-ui-smaller);
		color: var(--text-accent);
		font-weight: 600;
	}
	.lumina-inline-approval-body p {
		margin: 0;
		color: var(--text-muted);
	}
	.lumina-inline-approval-code {
		background: var(--background-primary);
		padding: 8px;
		border-radius: var(--radius-s);
		max-height: 150px;
		overflow-y: auto;
		font-family: var(--font-monospace);
		font-size: var(--font-ui-smaller);
		white-space: pre-wrap;
		word-break: break-all;
	}
	.lumina-inline-approval-code--danger {
		color: var(--text-error);
	}
	.lumina-inline-approval-footer {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 4px;
	}
	.lumina-inline-approval-btn-reject {
		background: transparent;
		box-shadow: none;
		color: var(--text-muted);
	}
	.lumina-inline-approval-btn-reject:hover {
		color: var(--text-normal);
		background: var(--background-modifier-hover);
	}

	/* Diff container styles */
	.lumina-diff-container {
		display: flex;
		flex-direction: column;
		gap: 12px;
	}

	.lumina-diff-chunk {
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-s);
		overflow: hidden;
		background: var(--background-primary);
	}

	.lumina-diff-chunk-lines {
		font-family: var(--font-monospace);
		font-size: var(--font-ui-small);
		line-height: 1.5;
		max-height: 200px;
		overflow-y: auto;
	}

	.lumina-diff-line {
		display: flex;
		padding: 1px 8px;
		white-space: pre-wrap;
		word-break: break-all;
	}

	.lumina-diff-line--added {
		background-color: rgba(0, 150, 0, 0.1);
	}

	.lumina-diff-line--removed {
		background-color: rgba(200, 0, 0, 0.1);
	}

	.lumina-diff-line-marker {
		width: 16px;
		flex-shrink: 0;
		color: var(--text-muted);
		user-select: none;
	}

	.lumina-diff-line--added .lumina-diff-line-marker {
		color: var(--text-success);
	}

	.lumina-diff-line--removed .lumina-diff-line-marker {
		color: var(--text-error);
	}

	.lumina-diff-line-text {
		flex-grow: 1;
	}

	.lumina-diff-chunk-actions {
		display: flex;
		justify-content: flex-end;
		gap: 6px;
		padding: 6px 8px;
		border-top: 1px solid var(--background-modifier-border);
		background: var(--background-secondary);
	}

	.lumina-inline-approval-btn-accept-chunk {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
		border: none;
		border-radius: var(--radius-s);
		padding: 4px 10px;
		font-size: var(--font-ui-smaller);
		cursor: pointer;
	}

	.lumina-inline-approval-btn-accept-chunk:hover {
		opacity: 0.9;
	}

	.lumina-inline-approval-btn-reject-chunk {
		background: transparent;
		border: 1px solid var(--background-modifier-border);
		border-radius: var(--radius-s);
		color: var(--text-muted);
		padding: 4px 10px;
		font-size: var(--font-ui-smaller);
		cursor: pointer;
	}

	.lumina-inline-approval-btn-reject-chunk:hover {
		color: var(--text-normal);
		background: var(--background-modifier-hover);
	}

	/* Progress indicators */
	.lumina-inline-approval-badge-progress {
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
		background: var(--background-modifier-hover);
		padding: 2px 6px;
		border-radius: var(--radius-s);
	}

	.lumina-inline-approval-progress-text {
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
		padding: 0 4px;
	}

	button:disabled {
		opacity: 0.4;
		cursor: not-allowed;
	}
</style>