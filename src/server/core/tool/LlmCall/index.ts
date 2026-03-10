import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import { OpenAI } from '@/server/service/openai';
import type { Logger } from '@/server/utils/logger';
import { InjectTokens, ToolIds } from '@/shared/constants';
import { ToolConfig, AgentEvent } from '@/shared/types';
import type { ChatCompletionCreateParams } from 'openai/resources/chat/completions';
import { inject } from 'tsyringe';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';

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
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, LlmCallOutput, void> {
    const response = await this.openai.chat.completions.create(
      {
        model: data.model || process.env.OPENAI_MODEL!,
        messages: [],
        ...data,
        stream: true,
      },
      { signal: ctx.signal },
    );

    let content = '';

    for await (const chunk of response) {
      const choice = chunk?.choices?.[0];
      const delta = choice?.delta?.content;
      const finishReason = choice?.finish_reason;

      if (delta) {
        content += delta;
        yield ctx.agentToolProgressEvent(this.id, delta);
      }

      if (finishReason) {
        if (finishReason === 'content_filter') {
          const error = 'Content filter triggered - response incomplete';
          this.logger.warn(`LLM stream aborted: ${error}`);
          throw new Error(error);
        }

        if (finishReason === 'length') {
          this.logger.warn(
            'LLM stream truncated: max_tokens limit reached - response may be incomplete',
          );
        }

        break;
      }
    }

    return content;
  }
}
