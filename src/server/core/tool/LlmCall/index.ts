import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import { OpenAI } from '@/server/service/openai';
import type { Logger } from '@/server/utils/logger';
import { InjectTokens, ToolIds } from '@/shared/constants';
import { ToolConfig, ToolEvent } from '@/shared/types';
import type { ChatCompletionCreateParams } from 'openai/resources/chat/completions';
import { inject } from 'tsyringe';
import { Tool } from '..';

export type LlmCallInput = Partial<ChatCompletionCreateParams>;
export type LlmCallOutput = string;

@tool(ToolIds.LLM_CALL)
export default class LlmCallTool extends Tool<LlmCallInput, LlmCallOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(@inject(InjectTokens.OPENAI) private readonly openai: OpenAI) {
    super();
  }

  async *call(
    @input() data: LlmCallInput,
    signal?: AbortSignal,
  ): AsyncGenerator<ToolEvent<LlmCallOutput>, LlmCallOutput, void> {
    const response = await this.openai.chat.completions.create(
      {
        model: data.model || process.env.OPENAI_MODEL!,
        messages: [],
        ...data,
        stream: true,
      },
      { signal },
    );

    let content = '';

    for await (const chunk of response) {
      const delta = chunk?.choices[0]?.delta?.content;
      if (delta) {
        content += delta;
        yield { type: 'delta', data: delta };
      }

      if (chunk.choices[0]?.finish_reason) {
        break;
      }
    }

    yield { type: 'result', result: content };
    return content;
  }
}
