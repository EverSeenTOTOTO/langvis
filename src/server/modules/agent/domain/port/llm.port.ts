import type { ChatCompletionCreateParams } from 'openai/resources/chat/completions';
import type { Logger } from '@/server/utils/logger';
import type {
  TextToSpeechInput,
  TextToSpeechOutput,
} from '@/server/modules/agent/implementations/tools/TextToSpeech';
import type {
  SpeechToTextInput,
  SpeechToTextOutput,
} from '@/server/modules/agent/implementations/tools/SpeechToText';

/**
 * LlmPort — LLM 能力抽象接口。
 *
 * Chat 方法：modelId 在 Adapter 构造时绑定，调用方不传。
 * Embed / Audio 方法：modelId 由调用方 per-call 指定（不同 model type / 用户 override）。
 */
export interface LlmPort {
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

  embed(
    modelId: string | undefined,
    texts: string[],
    signal: AbortSignal,
  ): Promise<{ embedding: number[] }[]>;

  tts(
    modelId: string | undefined,
    params: TextToSpeechInput,
    signal: AbortSignal,
  ): Promise<TextToSpeechOutput>;

  stt(
    modelId: string | undefined,
    params: SpeechToTextInput,
    signal: AbortSignal,
  ): Promise<SpeechToTextOutput>;
}
