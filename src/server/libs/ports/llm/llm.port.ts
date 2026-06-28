import type { ChatCompletionCreateParams } from 'openai/resources/chat/completions';
import type { Logger } from '@/server/utils/logger';
import type {
  TextToSpeechInput,
  TextToSpeechOutput,
  SpeechToTextInput,
  SpeechToTextOutput,
} from './llm.types';

/**
 * LlmPort — LLM 能力的单一内核契约（无绑定形态）。
 *
 * 所有方法 per-call 传 `modelId`（缺省由实现回退该 type 的默认模型）；调用方从
 * `ctx.chatModelId`（工具）/ `ctx.config`（loop）取，无需各自绑定。取代旧
 * `agent/domain/port/llm.port`（绑定版 chat/chatContent 不带 modelId）+
 * `agent/infrastructure/llm.adapter`（绑定层）——二者已删，本接口即 LlmProvider 的对外表面。
 */
export interface LlmPort {
  chat(
    modelId: string | undefined,
    data: Partial<ChatCompletionCreateParams>,
    signal: AbortSignal,
    logger: Logger,
  ): AsyncGenerator<string, string, void>;

  chatContent(
    modelId: string | undefined,
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
