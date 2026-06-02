import type { ChatCompletionCreateParams } from 'openai/resources/chat/completions';
import type { Logger } from '@/server/utils/logger';
import type { ChatLlm } from '../domain/chat-llm';
import type { LlmService } from '@/server/modules/memory/adapters/llm.adapter';

export class ChatLlmAdapter implements ChatLlm {
  constructor(
    private readonly llmService: LlmService,
    private readonly modelId: string | undefined,
  ) {}

  async *chat(
    data: Partial<ChatCompletionCreateParams>,
    signal: AbortSignal,
    logger: Logger,
  ): AsyncGenerator<string, string, void> {
    return yield* this.llmService.chat(this.modelId, data, signal, logger);
  }

  chatContent(
    data: Partial<ChatCompletionCreateParams>,
    signal: AbortSignal,
    logger: Logger,
  ): Promise<string> {
    return this.llmService.chatContent(this.modelId, data, signal, logger);
  }
}
