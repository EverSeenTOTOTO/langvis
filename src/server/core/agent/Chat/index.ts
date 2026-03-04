import { agent } from '@/server/decorator/core';
import { config } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { AgentIds, ToolIds } from '@/shared/constants';
import { AgentConfig, AgentEvent } from '@/shared/types';
import chalk from 'chalk';
import { container } from 'tsyringe';
import { Agent } from '..';
import { ExecutionContext } from '../../ExecutionContext';
import { Memory } from '../../memory';
import { Prompt } from '../../PromptBuilder';
import { Tool } from '../../tool';
import type LlmCallTool from '../../tool/LlmCall';
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

  get systemPrompt(): Prompt {
    return createPrompt(this, super.systemPrompt);
  }

  async *call(
    memory: Memory,
    ctx: ExecutionContext,
    @config() options?: ChatAgentConfig,
  ): AsyncGenerator<AgentEvent, void, void> {
    yield ctx.agentStartEvent();

    const llmCallTool = container.resolve<LlmCallTool>(ToolIds.LLM_CALL);

    const messages = await memory.summarize();
    const conversationMessages = messages.map(msg => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
    }));

    const model = options?.model?.code ?? process.env.OPENAI_MODEL;

    this.logger.debug(
      `Chat with ${chalk.bgRed(model)}, messages: `,
      conversationMessages,
    );

    for await (const event of llmCallTool.call(
      {
        model,
        temperature: options?.model?.temperature,
        messages: conversationMessages,
      },
      ctx,
    )) {
      if (event.type === 'tool_progress' && typeof event.data === 'string') {
        yield ctx.agentStreamEvent(event.data);
      } else {
        yield event;
      }
    }

    yield ctx.agentFinalEvent();
  }
}
