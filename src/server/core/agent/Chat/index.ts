import { logger } from '@/server/middleware/logger';
import { injectable, container } from 'tsyringe';
import { Agent } from '..';
import LlmCallTool from '../../tool/LlmCall';
import { Message } from '@/shared/entities/Message';
import { StreamChunk } from '@/shared/types';

@injectable()
export default class ChatAgent extends Agent {
  name!: string;
  description!: string;

  async getSystemPrompt(): Promise<string> {
    return `You are a helpful AI assistant. You engage in natural conversations with users, providing thoughtful and accurate responses. You maintain context from previous messages in the conversation to provide coherent and relevant answers.`;
  }

  async streamCall(
    messages: Message[],
    outputStream: WritableStream<StreamChunk>,
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
        model: config?.model?.code,
        temperature: config?.model?.temperature,
        messages: conversationMessages,
      },
      outputStream,
    );
  }
}
