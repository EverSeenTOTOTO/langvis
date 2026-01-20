import { agent } from '@/server/decorator/agenttool';
import { config } from '@/server/decorator/param';
import type { Logger } from '@/server/utils/logger';
import { AgentIds, ToolIds } from '@/shared/constants';
import { Message } from '@/shared/entities/Message';
import { AgentConfig, StreamChunk } from '@/shared/types';
import { container } from 'tsyringe';
import { Agent } from '..';
import type { Tool } from '../../tool';

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

  async streamCall(
    messages: Message[],
    outputWriter: WritableStreamDefaultWriter<StreamChunk>,
    @config() config?: ChatAgentConfig,
  ) {
    const llmCallTool = container.resolve<Tool>(ToolIds.LLM_CALL);

    const conversationMessages = messages.map(msg => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
    }));

    const model = config?.model?.code ?? process.env.OPENAI_MODEL;

    this.logger.debug(`Chat with ${model}, messages: `, conversationMessages);

    await llmCallTool.streamCall(
      {
        model,
        temperature: config?.model?.temperature,
        messages: conversationMessages,
      },
      outputWriter,
    );
  }
}
