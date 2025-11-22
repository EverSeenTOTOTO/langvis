import { InjectTokens } from '@/server/utils';
import OpenAI from 'openai';
import type { Stream } from 'openai/core/streaming.mjs';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions';
import { inject, injectable } from 'tsyringe';
import { Agent, type AgentCallContext, type AgentStreamCallContext } from '..';
import { AGENT_META } from '@/shared/constants';

@injectable()
export default class LlmCallTool implements Agent {
  static readonly Type = AGENT_META.LLM_CALL_TOOL.Type;
  static readonly Name = AGENT_META.LLM_CALL_TOOL.Name.en; // Access localized name
  static readonly Description = AGENT_META.LLM_CALL_TOOL.Description.en; // Access localized description

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
        const delta = chunk?.choices[0]?.delta?.content;
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
