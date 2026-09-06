export type CliAgentType = 'claude-code' | 'codex' | 'opencode' | 'antigravity';

export type CliEventType =
	| 'text'
	| 'thinking'
	| 'tool_call'
	| 'tool_result'
	| 'file_edit'
	| 'error'
	| 'status'
	| 'raw_log'
	| 'activity_status'
	| 'usage';

export interface CliToolCall {
	name: string;
	arguments?: Record<string, unknown>;
}

export interface CliToolResult {
	name: string;
	output?: string;
	error?: string;
}

export interface CliFileEdit {
	path: string;
	action: 'create' | 'modify' | 'delete';
}

export interface CliUsage {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
}

export interface CliEvent {
	type: CliEventType;
	content?: string;
	toolCall?: CliToolCall;
	toolResult?: CliToolResult;
	fileEdit?: CliFileEdit;
	usage?: CliUsage;
	raw?: unknown;
}

export interface CliExecuteOptions {
	cwd: string;
	model?: string;
	autoApprove?: boolean;
	allowedTools?: string[];
	contextFiles?: string[];
	env?: Record<string, string>;
	timeoutMs?: number;
	signal?: AbortSignal;
	agentEnabled?: boolean;
	agentExecutionMode?: 'read' | 'edit';
}

export interface CliExecution {
	events: AsyncIterable<CliEvent>;
	waitForExit(): Promise<{ exitCode: number; signal?: string }>;
	writeStdin?(data: string): void;
	kill(): void;
}

export interface CliToolCallLog {
	id: string;
	name: string;
	arguments?: Record<string, unknown>;
	output?: string;
	error?: string;
	timestamp: number;
	status: 'pending_approval' | 'running' | 'completed' | 'failed' | 'rejected';
}

export interface CliFileEditLog {
	id: string;
	path: string;
	action: 'create' | 'modify' | 'delete';
	timestamp: number;
	beforeContent?: string;
	afterContent?: string;
	diff?: string;
}
