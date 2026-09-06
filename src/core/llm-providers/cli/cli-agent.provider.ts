import type { ILLMProvider, ChatMessage, ChatOptions, ChatResponse, TokenUsage } from '../../../shared/types/llm.types';
import type { LLMProviderConfig } from '../../../shared/types/settings.types';
import type { CliExecution, CliExecuteOptions } from '../../../shared/types/cliAgent.types';
import { DEFAULT_CLI_BINARIES } from '../../../shared/types/settings.types';
import { ClaudeCodeProvider } from './agents/claude-code.provider';
import { CodexProvider } from './agents/codex.provider';
import { OpenCodeProvider } from './agents/opencode.provider';
import { AntigravityProvider } from './agents/antigravity.provider';
import type { BaseCliAgent } from './base-cli-agent';
import { getDefaultCwd } from './process-manager';

/**
 * 멀티턴 대화 메시지 배열을 CLI 에이전트에 전달할 단일 프롬프트 문자열로 변환합니다.
 * 단일 메시지인 경우 원문을 그대로 전달하고, 멀티턴인 경우 대화 맥락(역할 및 이전 답변)을 모두 보존합니다.
 */
export function formatMessagesToPrompt(messages: ChatMessage[]): string {
    if (!messages || messages.length === 0) return '';
    if (messages.length === 1) {
        const msg = messages[0];
        return typeof msg.content === 'string'
            ? msg.content
            : (msg.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || '');
    }

    return messages
        .map((m) => {
            const roleLabel = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System';
            const text = typeof m.content === 'string'
                ? m.content
                : (m.content?.filter(c => c.type === 'text').map(c => c.text).join('\n') || '');
            return `[${roleLabel}]:\n${text}`;
        })
        .join('\n\n');
}

/**
 * CLI 에이전트(Claude Code, Codex, OpenCode, Antigravity)를 ILLMProvider 인터페이스로 래핑하는 어댑터.
 * 모델 목록은 CLI 바이너리에서 100% 동적으로 조회하며, 터미널 CLI와 동일한 멀티턴/사고과정/도구실행 경험을 제공합니다.
 */
export class CliAgentProvider implements ILLMProvider {
    readonly providerId: string;
    private config: LLMProviderConfig;
    private agent: BaseCliAgent;

    constructor(config: LLMProviderConfig) {
        this.providerId = config.id;
        this.config = config;
        this.agent = this.createAgent();
    }

    private createAgent(): BaseCliAgent {
        // Build CLI agent config from LLMProviderConfig
        const agentConfig = {
            id: this.config.id,
            type: this.getAgentType(),
            binaryPath: this.config.binaryPath || DEFAULT_CLI_BINARIES[this.config.type] || '',
            defaultModel: this.config.availableModels[0],
            autoApprove: this.config.autoApprove ?? true,
            allowedTools: [] as string[],
            extraArgs: this.config.extraArgs || [],
            env: this.config.env || {},
            timeoutSeconds: this.config.timeoutSeconds || 300,
            isVerified: this.config.isVerified,
        };

        switch (this.config.type) {
            case 'cli-claude-code':
                return new ClaudeCodeProvider(agentConfig);
            case 'cli-codex':
                return new CodexProvider(agentConfig);
            case 'cli-opencode':
                return new OpenCodeProvider(agentConfig);
            case 'cli-antigravity':
                return new AntigravityProvider(agentConfig);
            default:
                throw new Error(`Unknown CLI agent type: ${this.config.type}`);
        }
    }

    private getAgentType(): 'claude-code' | 'codex' | 'opencode' | 'antigravity' {
        // Strip 'cli-' prefix to get the internal agent type
        return this.config.type.replace('cli-', '') as 'claude-code' | 'codex' | 'opencode' | 'antigravity';
    }

    /**
     * CLI 바이너리로부터 실제 지원 모델 목록을 100% 동적으로 가져옵니다.
     * 플러그인은 모델 목록을 임의로 하드코딩하거나 제한하지 않습니다.
     */
    async listModels(): Promise<string[]> {
        try {
            const dynamicModels = await this.agent.listModels();
            if (dynamicModels && dynamicModels.length > 0) {
                const unique = Array.from(new Set(dynamicModels));
                return unique.includes('default') ? unique : ['default', ...unique];
            }
        } catch {
            // fallback
        }
        return ['default'];
    }

    async chat(
        messages: ChatMessage[],
        options: ChatOptions,
        onChunk?: (chunk: string) => void,
    ): Promise<ChatResponse> {
        // Buffer the stream response
        let fullContent = '';
        const result = await this.stream(messages, options, (chunk) => {
            fullContent += chunk;
            onChunk?.(chunk);
        });
        return {
            content: fullContent,
            usage: result.usage,
            finishReason: result.finishReason,
        };
    }

    async stream(
        messages: ChatMessage[],
        options: ChatOptions,
        onChunk: (chunk: string) => void,
    ): Promise<{ usage?: TokenUsage; finishReason?: string }> {
        // 멀티턴 대화 맥락을 온전히 보존하여 프롬프트로 전달
        const prompt = formatMessagesToPrompt(messages);

        // Build execution options (순수 텍스트 LLM 어댑터로 동작)
        const execOptions: CliExecuteOptions = {
            cwd: options.cwd || getDefaultCwd(),
            model: options.model,
            autoApprove: false,
            agentEnabled: false,
            agentExecutionMode: 'read',
            signal: options.signal,
        };

        const execution = this.agent.execute(prompt, execOptions);
        let usage: TokenUsage | undefined;
        let isThinking = false;

        let hasProducedAnyText = false;

        // Consume the event stream
        for await (const event of execution.events) {
            if (options.signal?.aborted) break;

            if (event.type === 'thinking' && event.content) {
                if (!isThinking) {
                    isThinking = true;
                    onChunk('<think>\n');
                }
                onChunk(event.content);
            }

            if (event.type === 'text' && event.content) {
                hasProducedAnyText = true;
                if (isThinking) {
                    isThinking = false;
                    onChunk('\n</think>\n');
                }
                onChunk(event.content);
            }

            if (event.type === 'usage' && event.usage) {
                usage = {
                    inputTokens: event.usage.inputTokens || 0,
                    outputTokens: event.usage.outputTokens || 0,
                    totalTokens: event.usage.totalTokens || 0,
                };
            }

            if (event.type === 'error' && event.content) {
                throw new Error(event.content);
            }
        }

        if (isThinking) {
            onChunk('\n</think>\n');
        }

        const exitResult = await execution.waitForExit();
        if (exitResult.exitCode !== 0 && !hasProducedAnyText) {
            throw new Error(
                exitResult.signal
                    ? `CLI process terminated by ${exitResult.signal}`
                    : `CLI process exited with code ${exitResult.exitCode}`
            );
        }

        return { usage, finishReason: 'stop' };
    }

    async embed(): Promise<number[][]> {
        throw new Error('CLI agents do not support embedding');
    }

    /**
     * CLI 에이전트 실행을 위한 확장 메서드.
     * chatController에서 직접 이벤트 스트림을 소비할 때 사용.
     */
    public executeRaw(prompt: string, options: CliExecuteOptions): CliExecution {
        return this.agent.execute(prompt, options);
    }

    /**
     * CLI 바이너리 사용 가능 여부 확인.
     * 연결 테스트 시 사용.
     */
    public async checkAvailability(): Promise<{ available: boolean; version?: string; error?: string }> {
        return this.agent.checkAvailability();
    }

    /**
     * 현재 실행 중인 프로세스 강제 종료.
     */
    public abort(): void {
        this.agent.abort();
    }
}
