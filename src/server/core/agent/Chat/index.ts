import { agent } from '@/server/decorator/core';
import { config } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { AgentIds, ToolIds } from '@/shared/constants';
import { AgentConfig, AgentEvent } from '@/shared/types';
import chalk from 'chalk';
import { container } from 'tsyringe';
import { Agent } from '..';
import { ExecutionContext } from '../../context';
import { Memory } from '../../memory';
import type LlmCallTool from '../../tool/LlmCall';

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

  async getSystemPrompt(): Promise<string> {
    return `You are a helpful AI assistant. You engage in natural conversations with users, providing thoughtful and accurate responses. `;
  }

  async *call(
    memory: Memory,
    ctx: ExecutionContext,
    @config() options?: ChatAgentConfig,
  ): AsyncGenerator<AgentEvent, void, void> {
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

    const generator = llmCallTool.call(
      {
        model,
        temperature: options?.model?.temperature,
        messages: conversationMessages,
      },
      ctx,
    );

    for await (const toolEvent of generator) {
      yield ctx.adaptToolEvent(toolEvent);
    }

    yield ctx.agentEvent({ type: 'final' });
  }
}
