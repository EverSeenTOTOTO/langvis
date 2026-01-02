import { tool } from '@/server/decorator/agenttool';
import { OpenAI } from '@/server/service/openai';
import type { Logger } from '@/server/utils/logger';
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
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

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
    outputWriter: WritableStreamDefaultWriter,
  ): Promise<Stream<OpenAI.Chat.Completions.ChatCompletionChunk>> {
    // Convert current messages to OpenAI format
    const response = await this.openai.chat.completions.create({
      model: input.model || process.env.OPENAI_MODEL!,
      messages: [],
      ...input,
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
