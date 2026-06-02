import { agent } from '@/server/decorator/core';
import type { Logger } from '@/server/utils/logger';
import { AgentIds } from '@/shared/constants';
import type { AgentConfig } from '@/shared/types';
import type { AgentEvent, StreamChunk } from '@/shared/types/events';
import chalk from 'chalk';
import { inject } from 'tsyringe';
import { Agent } from '@/server/modules/agent/domain/agent.base';
import type { AgentRun } from '@/server/modules/agent/domain/agent-run.entity';
import type { Tool } from '@/server/modules/agent/domain/tool.base';
import { LlmService } from '@/server/service/LlmService';
import { Prompt } from '@/server/core/PromptBuilder';
import { createPrompt } from './chat.prompt';

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

  constructor(@inject(LlmService) private readonly llmService: LlmService) {
    super();
  }

  get systemPrompt(): Prompt {
    return createPrompt(
      this as unknown as Record<string, unknown>,
      super.systemPrompt,
    );
  }

  async *call(
    run: AgentRun,
  ): AsyncGenerator<AgentEvent | StreamChunk, void, void> {
    yield run.start();

    const cfg = run.config.runtimeConfig as ChatAgentConfig;
    const messages = await run.summarize();

    this.logger.debug(
      `Chat with ${chalk.bgRed(cfg.model?.modelId)}, messages: `,
      messages,
    );

    const generator = this.llmService.chat(
      cfg.model?.modelId,
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

    yield run.complete();
  }
}
