import { agent } from '@/server/decorator/core';
import type { Logger } from '@/server/utils/logger';
import { AgentIds } from '@/shared/constants';
import type { AgentConfig } from '@/shared/types';
import type { RunEvent } from '@/shared/types/events';
import chalk from 'chalk';
import { Agent } from '@/server/modules/agent/domain/model/agent.base';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { Tool } from '@/server/modules/agent/domain/model/tool.base';
import { Prompt } from '@/server/modules/agent/domain/model/prompt';
import { createPrompt } from './prompt';

interface ChatAgentConfig {
  model?: {
    modelId?: string;
    temperature?: number;
    topP?: number;
  };
}

@agent(AgentIds.CHAT)
export default class ChatAgent extends Agent {
  readonly id!: string;
  readonly config!: AgentConfig;
  protected readonly logger!: Logger;
  readonly tools!: Tool[];

  get systemPrompt(): Prompt {
    return createPrompt(
      this as unknown as Record<string, unknown>,
      super.systemPrompt,
    );
  }

  async *call(ctx: AgentRunContext): AsyncGenerator<RunEvent, void, void> {
    const cfg = ctx.config.runtimeConfig as ChatAgentConfig;
    const messages = await ctx.memory.buildContext();

    this.logger.debug(
      `Chat with ${chalk.bgRed(cfg.model?.modelId)}, messages: `,
      messages,
    );

    const generator = ctx.llm.chat(
      {
        messages,
        temperature: cfg.model?.temperature,
        top_p: cfg.model?.topP,
      },
      ctx.signal,
      this.logger,
    );

    for await (const chunk of generator) {
      yield { type: 'text_chunk', content: chunk };
    }
  }
}
