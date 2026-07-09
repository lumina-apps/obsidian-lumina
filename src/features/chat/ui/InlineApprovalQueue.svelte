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

	function getActionTitle(req: ApprovalRequest): string {
		if (req.actionType === 'mcp_tool') return $tStore("uiMessages.actionApproval.mcpTool") || `MCP Tool: ${req.metadata?.toolName || 'Unknown'}`;
		return $tStore("uiMessages.actionApproval.title", { action: req.actionType?.toUpperCase() || "" }) || `Approval Required: ${req.actionType}`;
	}

	function getActionDescription(req: ApprovalRequest): string {
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
</script>

<div class="lumina-inline-approvals">
	{#each $approvalStore.queue as req (req.id)}
		{#if req.actionType !== 'edit'}
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
					<button class="mod-warning" onclick={() => reject(req.id)}>
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
	}
	.lumina-inline-approval-path {
		font-size: var(--font-ui-smaller);
		color: var(--text-muted);
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
</style>
