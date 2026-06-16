import { agent } from '@/server/decorator/core';
import type { Logger } from '@/server/utils/logger';
import { AgentIds } from '@/shared/constants';
import type { AgentConfig } from '@/shared/types';
import type { AgentEvent, StreamChunk } from '@/shared/types/events';
import chalk from 'chalk';
import { Agent } from '@/server/modules/agent/domain/model/agent.base';
import type { AgentRun } from '@/server/modules/agent/domain/model/agent-run.entity';
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

  async *call(
    run: AgentRun,
  ): AsyncGenerator<AgentEvent | StreamChunk, void, void> {
    const cfg = run.config.runtimeConfig as ChatAgentConfig;
    const messages = await run.buildContext();

    this.logger.debug(
      `Chat with ${chalk.bgRed(cfg.model?.modelId)}, messages: `,
      messages,
    );

    const generator = run.llm.chat(
      {
        messages,
        temperature: cfg.model?.temperature,
        top_p: cfg.model?.topP,
      },
      run.signal,
      this.logger,
    );

    for await (const chunk of generator) {
      yield run.appendContent(chunk);
    }
  }
}
