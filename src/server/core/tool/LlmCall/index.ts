import { tool } from '@/server/decorator/core';
import { input } from '@/server/decorator/param';
import { LlmService } from '@/server/service/LlmService';
import type { Logger } from '@/server/utils/logger';
import { ToolIds } from '@/shared/constants';
import { ToolConfig, AgentEvent } from '@/shared/types';
import { inject } from 'tsyringe';
import { Tool } from '..';
import { ExecutionContext } from '../../ExecutionContext';

export type LlmCallInput = {
  modelId?: string;
  messages?: Array<{
    role: string;
    content: string;
    attachments?: any[] | null;
  }>;
  temperature?: number;
  topP?: number;
  stop?: string[];
  response_format?: { type: string };
};

export type LlmCallOutput = string;

@tool(ToolIds.LLM_CALL)
export default class LlmCallTool extends Tool<LlmCallInput, LlmCallOutput> {
  readonly id!: string;
  readonly config!: ToolConfig;
  protected readonly logger!: Logger;

  constructor(@inject(LlmService) private readonly llmService: LlmService) {
    super();
  }

  async *call(
    @input() data: LlmCallInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, LlmCallOutput, void> {
    return yield* this.llmService.chat(
      data.modelId,
      {
        messages: data.messages as any,
        temperature: data.temperature,
        top_p: data.topP,
        stop: data.stop,
        response_format: data.response_format as any,
      },
      ctx.signal,
      this.logger,
    );
  }
}
