import { agent } from '@/server/decorator/config';
import { logger } from '@/server/middleware/logger';
import { Message } from '@/shared/entities/Message';
import { AgentConfig, StreamChunk } from '@/shared/types';
import { container } from 'tsyringe';
import { Agent } from '..';
import type { Tool } from '../../tool';
import { AgentIds, ToolIds } from '@/shared/constants';

@agent(AgentIds.CHAT_AGENT)
export default class ChatAgent extends Agent {
  id!: string;
  config!: AgentConfig;

  async getSystemPrompt(): Promise<string> {
    return `You are a helpful AI assistant. You engage in natural conversations with users, providing thoughtful and accurate responses. You maintain context from previous messages in the conversation to provide coherent and relevant answers.`;
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

    logger.debug('Chat agent messages: ', conversationMessages);

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
