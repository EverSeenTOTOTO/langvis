import { agent } from '@/server/decorator/agenttool';
import type { Logger } from '@/server/utils/logger';
import { AgentIds, ToolIds } from '@/shared/constants';
import { Message } from '@/shared/entities/Message';
import { AgentConfig, StreamChunk } from '@/shared/types';
import { container } from 'tsyringe';
import { Agent } from '..';
import type { Tool } from '../../tool';

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
    outputStream: WritableStream<StreamChunk>,
    config?: Record<string, any>,
  ) {
    const llmCallTool = container.resolve<Tool>(ToolIds.LLM_CALL);

    const conversationMessages = messages.map(msg => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
    }));

    this.logger.debug('Chat agent messages: ', conversationMessages);

    await llmCallTool.streamCall(
      {
        model: config?.model?.code,
        temperature: config?.model?.temperature,
        messages: conversationMessages,
      },
      outputStream,
    );
  }
}
