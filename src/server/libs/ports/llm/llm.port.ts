import type { ChatCompletionCreateParams } from 'openai/resources/chat/completions';
import type {
  TextToSpeechInput,
  TextToSpeechOutput,
  SpeechToTextInput,
  SpeechToTextOutput,
} from './llm.types';

// LlmPort — LLM 单一内核契约（LlmProvider 对外表面）。各方法 per-call 传 modelId，缺省由实现回退该 type 默认模型。
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
