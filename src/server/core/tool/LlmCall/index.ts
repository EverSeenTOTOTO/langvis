import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import { OpenAI } from '@/server/service/openai';
import type { Logger } from '@/server/utils/logger';
import { InjectTokens, ToolIds } from '@/shared/constants';
import { ToolConfig } from '@/shared/types';
import type { Stream } from 'openai/core/streaming.mjs';
import type {
  ChatCompletion,
  ChatCompletionCreateParams,
  ChatCompletionCreateParamsNonStreaming,
} from 'openai/resources/chat/completions';
import { inject } from 'tsyringe';
import { Tool } from '..';

@tool(ToolIds.LLM_CALL)
export default class LlmCallTool extends Tool {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(@inject(InjectTokens.OPENAI) private readonly openai: OpenAI) {
    super();
  }

  async call(
    @input() data: Partial<ChatCompletionCreateParamsNonStreaming>,
  ): Promise<ChatCompletion> {
    const response = await this.openai.chat.completions.create({
      model: data.model || process.env.OPENAI_MODEL!,
      messages: [],
      ...data,
      stream: false,
    });
    return response;
  }

  async streamCall(
    @input() data: Partial<ChatCompletionCreateParams>,
    outputWriter: WritableStreamDefaultWriter,
  ): Promise<Stream<OpenAI.Chat.Completions.ChatCompletionChunk>> {
    const response = await this.openai.chat.completions.create({
      model: data.model || process.env.OPENAI_MODEL!,
      messages: [],
      ...data,
      stream: true,
    });

    const writer = outputWriter;

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
