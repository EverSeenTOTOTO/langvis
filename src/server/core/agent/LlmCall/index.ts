import { inject, injectable } from 'tsyringe';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions';
import { Agent, type AgentCallContext, type AgentStreamCallContext } from '..';
import { InjectTokens } from '../../../utils';
import OpenAI from 'openai';
import type { Stream } from 'openai/core/streaming.mjs';

@injectable()
export default class LlmCallTool implements Agent {
  constructor(@inject(InjectTokens.OPENAI) private readonly openai: OpenAI) {}

  async call(
    _ctx: AgentCallContext,
    input: Partial<ChatCompletionCreateParamsNonStreaming>,
  ): Promise<ChatCompletion> {
    const response = await this.openai.chat.completions.create({
      model: process.env.OPENAI_MODEL!,
      messages: [],
      ...input,
      stream: false,
    });
    return response;
  }

  async streamCall(
    { outputStream }: AgentStreamCallContext,
    input: Partial<ChatCompletionCreateParamsStreaming>,
  ): Promise<Stream<OpenAI.Chat.Completions.ChatCompletionChunk>> {
    const response = await this.openai.chat.completions.create({
      model: process.env.OPENAI_MODEL!,
      messages: [],
      ...input,
      stream: true,
    });

    const writer = outputStream.getWriter();

    try {
      for await (const chunk of response) {
        const delta = chunk?.choices[0]?.delta?.content || '';
        if (delta) {
          await writer.write(delta);
        }

        if (chunk.choices[0]?.finish_reason) {
          await writer.close();
          break;
        }
      }
    } catch (error) {
      await writer.abort(error);
      throw error;
    }

    return response;
  }
}
