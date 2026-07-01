import type { ChatCompletionCreateParams } from 'openai/resources/chat/completions';
import type {
  TextToSpeechInput,
  TextToSpeechOutput,
  SpeechToTextInput,
  SpeechToTextOutput,
} from './llm.types';

/**
 * LlmPort — LLM 能力的单一内核契约（无绑定形态）。
 *
 * 所有方法 per-call 传 `modelId`（缺省由实现回退该 type 的默认模型），调用方无需各自绑定。
 * 取代旧的绑定版 agent/domain/port/llm.port + agent/infrastructure/llm.adapter（二者已删），本接口即 LlmProvider 的对外表面。
 */
export interface LlmPort {
  chat(
    modelId: string | undefined,
    data: Partial<ChatCompletionCreateParams>,
    signal: AbortSignal,
  ): AsyncGenerator<string, string, void>;

  chatContent(
    modelId: string | undefined,
    data: Partial<ChatCompletionCreateParams>,
    signal: AbortSignal,
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
