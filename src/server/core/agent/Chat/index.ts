import { agent } from '@/server/decorator/core';
import { config } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { AgentIds } from '@/shared/constants';
import { AgentConfig, AgentEvent } from '@/shared/types';
import chalk from 'chalk';
import { Agent } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import { Memory } from '../../memory';
import { Prompt } from '../../PromptBuilder';
import { Tool } from '../../tool';
import { createPrompt } from './prompt';

interface ChatAgentConfig {
  model?: {
    code?: string;
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
  readonly agents!: Agent[];

  get systemPrompt(): Prompt {
    return createPrompt(this, super.systemPrompt);
  }

  async *call(
    memory: Memory,
    ctx: ExecutionContext,
    @config() options?: ChatAgentConfig,
  ): AsyncGenerator<AgentEvent, void, void> {
    yield ctx.agentStartEvent();

    const messages = await memory.summarize();

    const model = options?.model?.code ?? process.env.OPENAI_MODEL;

    this.logger.debug(`Chat with ${chalk.bgRed(model)}, messages: `, messages);

    yield* ctx.callLlm(
      {
        model,
        temperature: options?.model?.temperature,
        messages,
      },
      false,
    );

    yield ctx.agentFinalEvent();
  }
}
