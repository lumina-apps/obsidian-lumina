export type AutopilotType = 'claude-code' | 'codex' | 'opencode' | 'antigravity';

export type AutopilotEventType =
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

export interface AutopilotToolCall {
	name: string;
	arguments?: Record<string, unknown>;
}

export interface AutopilotToolResult {
	name: string;
	output?: string;
	error?: string;
}

export interface AutopilotFileEdit {
	path: string;
	action: 'create' | 'modify' | 'delete';
}

export interface AutopilotUsage {
	inputTokens?: number;
	outputTokens?: number;
	totalTokens?: number;
}

export interface AutopilotEvent {
	type: AutopilotEventType;
	content?: string;
	toolCall?: AutopilotToolCall;
	toolResult?: AutopilotToolResult;
	fileEdit?: AutopilotFileEdit;
	usage?: AutopilotUsage;
	raw?: unknown;
}

export interface AutopilotExecuteOptions {
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

export interface AutopilotExecution {
	events: AsyncIterable<AutopilotEvent>;
	waitForExit(): Promise<{ exitCode: number; signal?: string }>;
	writeStdin?(data: string): void;
	kill(): void;
}

export interface AutopilotToolCallLog {
	id: string;
	name: string;
	arguments?: Record<string, unknown>;
	output?: string;
	error?: string;
	timestamp: number;
	status: 'pending_approval' | 'running' | 'completed' | 'failed' | 'rejected';
}

export interface AutopilotFileEditLog {
	id: string;
	path: string;
	action: 'create' | 'modify' | 'delete';
	timestamp: number;
	beforeContent?: string;
	afterContent?: string;
	diff?: string;
}

