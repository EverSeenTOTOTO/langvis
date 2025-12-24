import { tool } from '@/server/decorator/config';
import { OpenAI } from '@/server/service/openai';
import { InjectTokens, ToolIds } from '@/shared/constants';
import { ToolConfig } from '@/shared/types';
import type { Stream } from 'openai/core/streaming.mjs';
import type {
  ChatCompletion,
  ChatCompletionCreateParamsNonStreaming,
  ChatCompletionCreateParamsStreaming,
} from 'openai/resources/chat/completions';
import { inject } from 'tsyringe';
import { Tool } from '..';

@tool(ToolIds.LLM_CALL)
export default class LlmCallTool extends Tool {
  id!: string;
  config!: ToolConfig;

  constructor(@inject(InjectTokens.OPENAI) private readonly openai: OpenAI) {
    super();
  }

  async call(
    input: Partial<ChatCompletionCreateParamsNonStreaming>,
  ): Promise<ChatCompletion> {
    const response = await this.openai.chat.completions.create({
      model: input.model || process.env.OPENAI_MODEL!,
      messages: [],
      ...input,
      stream: false,
    });
    return response;
  }

  async streamCall(
    input: Partial<ChatCompletionCreateParamsStreaming>,
    outputStream: WritableStream,
  ): Promise<Stream<OpenAI.Chat.Completions.ChatCompletionChunk>> {
    // Convert current messages to OpenAI format
    const response = await this.openai.chat.completions.create({
      model: input.model || process.env.OPENAI_MODEL!,
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
