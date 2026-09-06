<script lang="ts">
	import type { AutopilotToolCallLog } from '../../../../shared/types/autopilot.types';
	import { iconAction } from '../../../../shared/utils/domUtils';
	import { tStore } from '../../../../shared/locales/index';

	let {
		toolCall,
		onApprove,
		onReject,
	}: {
		toolCall: AutopilotToolCallLog;
		onApprove?: (id: string) => void;
		onReject?: (id: string) => void;
	} = $props();

	let isOpen = $state(false);

	$effect(() => {
		if (toolCall.status === 'pending_approval' || toolCall.status === 'running') {
			isOpen = true;
		}
	});

	function toggle() {
		isOpen = !isOpen;
	}

	const toolMeta = $derived.by(() => {
		const name = (toolCall.name || '').toLowerCase();
		const args = (toolCall.arguments || {}) as Record<string, unknown>;
		const targetFile = (args.file_path || args.path || args.file || args.filename || args.TargetFile) as string | undefined;
		const command = (args.command || args.cmd || args.CommandLine) as string | undefined;
		const query = (args.query || args.pattern || args.Query || args.Pattern) as string | undefined;

		if (name.includes('view') || name.includes('read')) {
			return {
				icon: 'file-text',
				title: targetFile ? `Read: ${targetFile}` : toolCall.name,
				category: 'File Read',
			};
		}
		if (name.includes('edit') || name.includes('write') || name.includes('replace') || name.includes('patch')) {
			return {
				icon: 'file-edit',
				title: targetFile ? `Edit: ${targetFile}` : toolCall.name,
				category: 'File Edit',
			};
		}
		if (name.includes('bash') || name.includes('exec') || name.includes('terminal') || name.includes('command') || name.includes('run')) {
			return {
				icon: 'terminal',
				title: command ? `$ ${command}` : toolCall.name,
				category: 'Terminal',
			};
		}
		if (name.includes('grep') || name.includes('search')) {
			return {
				icon: 'search',
				title: query ? `Search: "${query}"` : toolCall.name,
				category: 'Search',
			};
		}
		if (name.includes('glob') || name.includes('list') || name.includes('dir') || name.includes('find')) {
			return {
				icon: 'folder-search',
				title: targetFile || query ? `Find: ${targetFile || query}` : toolCall.name,
				category: 'File Search',
			};
		}

		return {
			icon: 'wrench',
			title: toolCall.name,
			category: 'Tool',
		};
	});
</script>

<div class="lumina-autopilot-tool-call" class:is-open={isOpen} class:is-pending={toolCall.status === 'pending_approval'}>
	<button class="lumina-autopilot-tool-call__header" onclick={toggle} type="button">
		<span class="lumina-autopilot-tool-call__icon" use:iconAction={toolMeta.icon}></span>
		<div class="lumina-autopilot-tool-call__name-wrap">
			<span class="lumina-autopilot-tool-call__badge">{toolMeta.category}</span>
			<span class="lumina-autopilot-tool-call__name">{toolMeta.title}</span>
		</div>

		{#if toolCall.status === 'pending_approval'}
			<span class="lumina-autopilot-tool-call__status is-pending">
				🛡️ {$tStore('settings.cli.waitingApprovalBadge') || 'Approval Required'}
			</span>
		{:else if toolCall.status === 'running'}
			<span class="lumina-autopilot-tool-call__status is-running">
				<span class="lumina-autopilot-tool-call__spinner"></span>
				running...
			</span>
		{:else if toolCall.status === 'rejected'}
			<span class="lumina-autopilot-tool-call__status is-rejected">rejected</span>
		{:else if toolCall.status === 'failed'}
			<span class="lumina-autopilot-tool-call__status is-failed">failed</span>
		{:else}
			<span class="lumina-autopilot-tool-call__status is-completed">✓</span>
		{/if}

		<span class="lumina-autopilot-tool-call__chevron" use:iconAction={isOpen ? 'chevron-down' : 'chevron-right'}></span>
	</button>

	{#if isOpen}
		<div class="lumina-autopilot-tool-call__body">
			{#if toolCall.arguments && Object.keys(toolCall.arguments).length > 0}
				<div class="lumina-autopilot-tool-call__section">
					<div class="lumina-autopilot-tool-call__section-title">Arguments</div>
					<pre class="lumina-autopilot-tool-call__code"><code>{JSON.stringify(toolCall.arguments, null, 2)}</code></pre>
				</div>
			{/if}

			{#if toolCall.output}
				<div class="lumina-autopilot-tool-call__section">
					<div class="lumina-autopilot-tool-call__section-title">Output</div>
					<pre class="lumina-autopilot-tool-call__code"><code>{toolCall.output}</code></pre>
				</div>
			{/if}

			{#if toolCall.error}
				<div class="lumina-autopilot-tool-call__section is-error">
					<div class="lumina-autopilot-tool-call__section-title">Error</div>
					<pre class="lumina-autopilot-tool-call__code is-error"><code>{toolCall.error}</code></pre>
				</div>
			{/if}

			{#if toolCall.status === 'pending_approval'}
				<div class="lumina-autopilot-tool-call__approval-bar">
					<span class="lumina-autopilot-tool-call__approval-text">
						{$tStore('settings.cli.approvalPrompt') || 'Do you want to allow this tool execution?'}
					</span>
					<div class="lumina-autopilot-tool-call__approval-actions">
						<button
							class="lumina-autopilot-tool-call__btn is-reject"
							onclick={() => onReject?.(toolCall.id)}
							type="button"
						>
							<span use:iconAction={'x'}></span>
							<span>{$tStore('settings.cli.rejectBtn') || 'Reject'}</span>
						</button>
						<button
							class="lumina-autopilot-tool-call__btn is-approve"
							onclick={() => onApprove?.(toolCall.id)}
							type="button"
						>
							<span use:iconAction={'check'}></span>
							<span>{$tStore('settings.cli.approveBtn') || 'Approve'}</span>
						</button>
					</div>
				</div>
			{/if}
		</div>
	{/if}
</div>

<style>
	.lumina-autopilot-tool-call {
		border: 1px solid var(--background-modifier-border);
		border-radius: 6px;
		margin: 6px 0;
		background: var(--background-secondary);
		overflow: hidden;
		font-size: 12px;
	}

	.lumina-autopilot-tool-call.is-pending {
		border-color: var(--text-warning);
		background: color-mix(in srgb, var(--text-warning) 5%, var(--background-secondary));
	}

	.lumina-autopilot-tool-call__header {
		display: flex;
		align-items: center;
		width: 100%;
		padding: 6px 10px;
		background: transparent;
		border: none;
		cursor: pointer;
		text-align: left;
		gap: 8px;
		color: var(--text-normal);
	}

	.lumina-autopilot-tool-call__header:hover {
		background: var(--background-modifier-hover);
	}

	.lumina-autopilot-tool-call__icon {
		display: flex;
		align-items: center;
		color: var(--text-muted);
		flex-shrink: 0;
	}

	.lumina-autopilot-tool-call__name-wrap {
		display: flex;
		align-items: center;
		gap: 6px;
		flex: 1;
		min-width: 0;
	}

	.lumina-autopilot-tool-call__badge {
		font-size: 10px;
		text-transform: uppercase;
		background: var(--background-modifier-border);
		color: var(--text-muted);
		padding: 1px 4px;
		border-radius: 3px;
		font-weight: 600;
		flex-shrink: 0;
	}

	.lumina-autopilot-tool-call__name {
		font-family: var(--font-monospace);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		color: var(--text-normal);
	}

	.lumina-autopilot-tool-call__status {
		font-size: 11px;
		margin-left: auto;
		flex-shrink: 0;
		display: flex;
		align-items: center;
		gap: 4px;
	}

	.lumina-autopilot-tool-call__status.is-pending {
		color: var(--text-warning);
		font-weight: 600;
	}

	.lumina-autopilot-tool-call__status.is-running {
		color: var(--text-accent);
	}

	.lumina-autopilot-tool-call__status.is-completed {
		color: var(--text-success);
	}

	.lumina-autopilot-tool-call__status.is-failed,
	.lumina-autopilot-tool-call__status.is-rejected {
		color: var(--text-error);
	}

	.lumina-autopilot-tool-call__spinner {
		display: inline-block;
		width: 10px;
		height: 10px;
		border: 1.5px solid var(--text-accent);
		border-top-color: transparent;
		border-radius: 50%;
		animation: spin 1s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}

	.lumina-autopilot-tool-call__chevron {
		color: var(--text-muted);
		flex-shrink: 0;
		display: flex;
		align-items: center;
	}

	.lumina-autopilot-tool-call__body {
		padding: 8px 10px;
		border-top: 1px solid var(--background-modifier-border);
		background: var(--background-primary);
	}

	.lumina-autopilot-tool-call__section {
		margin-bottom: 8px;
	}

	.lumina-autopilot-tool-call__section:last-child {
		margin-bottom: 0;
	}

	.lumina-autopilot-tool-call__section-title {
		font-size: 10px;
		text-transform: uppercase;
		color: var(--text-muted);
		font-weight: 600;
		margin-bottom: 4px;
	}

	.lumina-autopilot-tool-call__code {
		margin: 0;
		padding: 6px 8px;
		background: var(--background-secondary);
		border-radius: 4px;
		font-size: 11px;
		max-height: 200px;
		overflow-y: auto;
		white-space: pre-wrap;
		word-break: break-all;
	}

	.lumina-autopilot-tool-call__code.is-error {
		color: var(--text-error);
		background: color-mix(in srgb, var(--text-error) 10%, var(--background-secondary));
	}

	.lumina-autopilot-tool-call__approval-bar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 8px;
		background: color-mix(in srgb, var(--text-warning) 10%, var(--background-secondary));
		border-radius: 4px;
		margin-top: 8px;
		gap: 8px;
	}

	.lumina-autopilot-tool-call__approval-text {
		font-weight: 500;
		color: var(--text-normal);
		font-size: 12px;
	}

	.lumina-autopilot-tool-call__approval-actions {
		display: flex;
		gap: 6px;
		flex-shrink: 0;
	}

	.lumina-autopilot-tool-call__btn {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		padding: 4px 10px;
		border-radius: 4px;
		font-size: 12px;
		font-weight: 600;
		cursor: pointer;
		border: none;
	}

	.lumina-autopilot-tool-call__btn.is-approve {
		background: var(--interactive-accent);
		color: var(--text-on-accent);
	}

	.lumina-autopilot-tool-call__btn.is-reject {
		background: var(--background-modifier-border);
		color: var(--text-normal);
	}

	.lumina-autopilot-tool-call__btn:hover {
		opacity: 0.9;
	}
</style>

