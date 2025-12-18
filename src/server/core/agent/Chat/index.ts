import { logger } from '@/server/middleware/logger';
import { injectable, container } from 'tsyringe';
import type { Agent } from '..';
import LlmCallTool from '../../tool/LlmCall';
import { Message } from '@/shared/entities/Message';

@injectable()
export default class ChatAgent implements Agent {
  name!: string;
  description!: string;

  async getSystemPrompt(): Promise<string> {
    return `You are a helpful AI assistant. You engage in natural conversations with users, providing thoughtful and accurate responses. You maintain context from previous messages in the conversation to provide coherent and relevant answers.`;
  }

  async call(): Promise<unknown> {
    throw new Error('Non-streaming call not implemented.');
  }

  async streamCall(
    messages: Message[],
    outputStream: WritableStream,
    config?: Record<string, any>,
  ) {
    const llmCallTool = container.resolve<LlmCallTool>('LlmCall Tool');

    const conversationMessages = messages.map(msg => ({
      role: msg.role as 'user' | 'assistant' | 'system',
      content: msg.content,
    }));

    logger.debug('Chat agent messages: ', conversationMessages);

    await llmCallTool.streamCall(
      {
        model: config?.model,
        temperature: config?.temperature ?? 0.7,
        messages: conversationMessages,
      },
      outputStream,
    );
  }
}

