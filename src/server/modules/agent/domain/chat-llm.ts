import type { ChatCompletionCreateParams } from 'openai/resources/chat/completions';
import type { Logger } from '@/server/utils/logger';

export interface ChatLlm {
  chat(
    data: Partial<ChatCompletionCreateParams>,
    signal: AbortSignal,
    logger: Logger,
  ): AsyncGenerator<string, string, void>;

  chatContent(
    data: Partial<ChatCompletionCreateParams>,
    signal: AbortSignal,
    logger: Logger,
  ): Promise<string>;
}
