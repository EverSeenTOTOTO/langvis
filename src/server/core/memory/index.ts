import { AgentEvent } from '@/shared/types';
import { LlmMessage, Message } from '@/shared/types/entities';
import type { Logger } from '@/server/utils/logger';
import { estimateTokens } from '@/server/utils/estimateTokens';

export interface MemoryConfig {
  messages?: Message[];
  windowSize?: number;
  modelId?: string;
  contextSize?: number;
}

export interface ContextUsage {
  used: number;
  total: number;
}

export abstract class Memory {
  protected readonly logger!: Logger;
  protected config: MemoryConfig = {};
  protected windowSize: number = Number.MAX_SAFE_INTEGER;

  protected context: Message[] = [];

  configure(config: MemoryConfig): void {
    this.config = { ...this.config, ...config };
    if (config.windowSize !== undefined) {
      this.windowSize = config.windowSize;
    }
    if (config.messages) {
      this.context = config.messages;
    }
  }

  async summarize(): Promise<Message[]> {
    return this.context;
  }

  async *preTurn(
    _messages: Message[],
  ): AsyncGenerator<AgentEvent, void, void> {}

  async *postTurn(
    _currentMessage?: Message,
  ): AsyncGenerator<AgentEvent, void, void> {}

  async *preStep(
    _stepIndex: number,
    _iterMessages: LlmMessage[],
  ): AsyncGenerator<AgentEvent, void, void> {}

  async *postStep(
    _stepIndex: number,
    _iterMessages: LlmMessage[],
  ): AsyncGenerator<AgentEvent, void, void> {}

  protected async *yieldContextUsage(
    messages: LlmMessage[],
    messageId: string,
  ): AsyncGenerator<AgentEvent, void, void> {
    const { modelId, contextSize } = this.config;
    if (!modelId || !contextSize) return;

    const used = estimateTokens(messages, modelId);
    yield {
      type: 'context_usage',
      messageId,
      used,
      total: contextSize,
      seq: Date.now(),
      at: Date.now(),
    };
  }
}
