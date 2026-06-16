import type { ChatCompletionCreateParams } from 'openai/resources/chat/completions';
import type { Logger } from '@/server/utils/logger';
import type { Llm } from '../domain/llm';
import type {
  TextToSpeechInput,
  TextToSpeechOutput,
} from '@/server/modules/agent/implementations/tools/TextToSpeech';
import type {
  SpeechToTextInput,
  SpeechToTextOutput,
} from '@/server/modules/agent/implementations/tools/SpeechToText';
import type { LlmService } from '@/server/modules/memory/application/llm.service';

export class LlmAdapter implements Llm {
  constructor(
    private readonly llmService: LlmService,
    private readonly chatModelId: string | undefined,
  ) {}

  async *chat(
    data: Partial<ChatCompletionCreateParams>,
    signal: AbortSignal,
    logger: Logger,
  ): AsyncGenerator<string, string, void> {
    return yield* this.llmService.chat(this.chatModelId, data, signal, logger);
  }

  chatContent(
    data: Partial<ChatCompletionCreateParams>,
    signal: AbortSignal,
    logger: Logger,
  ): Promise<string> {
    return this.llmService.chatContent(this.chatModelId, data, signal, logger);
  }

  embed(
    modelId: string | undefined,
    texts: string[],
    signal: AbortSignal,
  ): Promise<{ embedding: number[] }[]> {
    return this.llmService.embed(modelId, texts, signal);
  }

  tts(
    modelId: string | undefined,
    params: TextToSpeechInput,
    signal: AbortSignal,
  ): Promise<TextToSpeechOutput> {
    return this.llmService.tts(modelId, params, signal);
  }

  stt(
    modelId: string | undefined,
    params: SpeechToTextInput,
    signal: AbortSignal,
  ): Promise<SpeechToTextOutput> {
    return this.llmService.stt(modelId, params, signal);
  }
}
