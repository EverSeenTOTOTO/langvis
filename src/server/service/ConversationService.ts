import {
  Conversation,
  ConversationEntity,
} from '@/shared/entities/Conversation';
import { Message, MessageEntity, Role } from '@/shared/entities/Message';
import { inject, singleton } from 'tsyringe';
import { In } from 'typeorm';
import { logger } from '../middleware/logger';
import pg from './pg';
import { SSEService } from './SSEService';
import { omit } from 'lodash-es';

@singleton()
export class ConversationService {
  constructor(
    @inject(SSEService)
    private sseService: SSEService,
  ) {}

  async createConversation(
    name: string,
    config?: Record<string, any> | null,
  ): Promise<Conversation> {
    const finalConfig = config ?? {};
    if (!finalConfig.agent) {
      finalConfig.agent = 'Chat Agent';
    }

    const conversationRepository = pg.getRepository(ConversationEntity);
    const conversation = conversationRepository.create({
      name,
      config: finalConfig,
    });
    return await conversationRepository.save(conversation);
  }

  async getConversationById(id: string): Promise<Conversation | null> {
    const conversationRepository = pg.getRepository(ConversationEntity);
    return await conversationRepository.findOneBy({ id });
  }

  async getAllConversations(): Promise<Conversation[]> {
    const conversationRepository = pg.getRepository(ConversationEntity);
    return await conversationRepository.find();
  }

  async updateConversation(
    id: string,
    name: string,
    config?: Record<string, any> | null,
  ): Promise<Conversation | null> {
    const conversationRepository = pg.getRepository(ConversationEntity);
    const conversation = await conversationRepository.findOneBy({ id });
    if (!conversation) {
      return null;
    }
    conversation.name = name;
    if (config !== undefined) {
      conversation.config = config ?? null;
    }
    return await conversationRepository.save(conversation);
  }

  async deleteConversation(id: string): Promise<boolean> {
    const conversationRepository = pg.getRepository(ConversationEntity);
    const messageRepository = pg.getRepository(MessageEntity);

    // Find the conversation with its messages
    const conversation = await conversationRepository.findOne({
      where: { id },
      relations: ['messages'],
    });

    if (!conversation) {
      return false;
    }

    // Delete all messages associated with the conversation
    if (conversation.messages && conversation.messages.length > 0) {
      await messageRepository.delete({
        conversationId: id,
      });
    }

    // Delete the conversation itself
    await conversationRepository.delete(id);
    return true;
  }
  async addMessageToConversation(
    conversationId: string,
    role: Role,
    content: string,
    meta?: Record<string, any> | null,
  ): Promise<Message | null> {
    const conversation = await this.getConversationById(conversationId);

    if (!conversation) {
      return null;
    }

    const messageRepository = pg.getRepository(MessageEntity);
    const message = messageRepository.create({
      conversationId,
      role,
      content,
      meta,
    });

    return await messageRepository.save(message);
  }

  async batchAddMessages(
    conversationId: string,
    messagesData: Array<{
      role: Role;
      content: string;
      meta?: Record<string, any> | null;
      createdAt?: Date;
    }>,
  ): Promise<Message[]> {
    const conversation = await this.getConversationById(conversationId);

    if (!conversation) {
      throw new Error(`Conversation ${conversationId} not found`);
    }

    const messageRepository = pg.getRepository(MessageEntity);
    const messages = messagesData.map(data =>
      messageRepository.create({
        conversationId,
        role: data.role,
        content: data.content,
        meta: data.meta,
        ...(data.createdAt && { createdAt: data.createdAt }),
      }),
    );

    return await messageRepository.save(messages);
  }

  async getMessagesByConversationId(
    conversationId: string,
  ): Promise<Message[]> {
    const messageRepository = pg.getRepository(MessageEntity);
    return await messageRepository.find({
      where: { conversationId },
      order: { createdAt: 'ASC' },
    });
  }

  async batchDeleteMessagesInConversation(
    conversationId: string,
    messageIds: string[],
  ) {
    const messageRepository = pg.getRepository(MessageEntity);

    return await messageRepository.delete({
      conversationId,
      id: In(messageIds),
    });
  }

  async updateMessage(
    messageId: string,
    content: string,
    meta?: Record<string, any> | null,
  ): Promise<Message | null> {
    const messageRepository = pg.getRepository(MessageEntity);
    const message = await messageRepository.findOneBy({ id: messageId });

    if (!message) {
      return null;
    }

    message.content = content;
    if (meta !== undefined) {
      message.meta = meta;
    }
    return await messageRepository.save(message);
  }

  /**
   * Delete all messages after a specific message (for rollback operations)
   */
  async deleteMessagesAfter(
    conversationId: string,
    afterMessageId: string,
  ): Promise<boolean> {
    const messageRepository = pg.getRepository(MessageEntity);

    // Get the target message to get its timestamp
    const targetMessage = await messageRepository.findOneBy({
      id: afterMessageId,
      conversationId,
    });

    if (!targetMessage) {
      return false;
    }

    // Delete all messages created after the target message
    await messageRepository
      .createQueryBuilder()
      .delete()
      .from(MessageEntity)
      .where('conversationId = :conversationId', { conversationId })
      .andWhere('createdAt > :createdAt', {
        createdAt: targetMessage.createdAt,
      })
      .execute();

    return true;
  }

  async createStreamForMessage(
    conversationId: string,
    message: Message,
  ): Promise<WritableStream<string>> {
    // Record start time for logging
    const startTime = Date.now();

    // Create a custom WritableStream that integrates with streaming message service
    const writableStream = new WritableStream<string>({
      write: async (chunk: string) => {
        // Update the streaming message
        message.content += chunk;

        // Log first chunk received
        const isFirstChunk = message.content.length === chunk.length;

        if (isFirstChunk) {
          logger.info(
            `First chunk received for agent call in conversation ${conversationId}, time taken: ${Date.now() - startTime}ms`,
          );
        }

        this.sseService.sendToConversation(conversationId, {
          type: 'completion_delta',
          content: chunk,
        });
      },
      close: async () => {
        try {
          // Save final content to database
          await this.updateMessage(
            message.id,
            message.content,
            omit(message.meta, 'loading'),
          );
        } catch (error) {
          logger.error('Failed to finalize streaming message:', error);
        }

        // Send completion done message
        this.sseService.sendToConversation(conversationId, {
          type: 'completion_done',
        });

        const elapsed = Date.now() - startTime;
        logger.info(
          `Agent call finished for conversation ${conversationId}, total time: ${elapsed}ms, time per token: ${
            elapsed / (message.content.length || 1)
          }ms`,
        );
      },
      abort: async (reason: unknown) => {
        try {
          // Save final content to database
          await this.updateMessage(
            message.id,
            (reason as Error)?.message || `Aborted`,
            {
              ...message.meta,
              loading: undefined,
              error: true,
            },
          );
        } catch (error) {
          logger.error('Failed to finalize streaming message:', error);
        }

        // Send completion done message
        this.sseService.sendToConversation(conversationId, {
          type: 'completion_error',
          error: (reason as Error)?.message,
        });
      },
    });

    return writableStream;
  }
}
