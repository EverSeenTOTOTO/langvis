import { AgentIds } from '@/shared/constants';
import {
  Conversation,
  ConversationEntity,
} from '@/shared/entities/Conversation';
import { Message, MessageEntity, Role } from '@/shared/entities/Message';
import { StreamChunk } from '@/shared/types';
import { omit } from 'lodash-es';
import PQueue from 'p-queue';
import { inject } from 'tsyringe';
import { In } from 'typeorm';
import { service } from '../decorator/service';
import Logger from '../utils/logger';
import pg from './pg';
import { SSEService } from './SSEService';

@service()
export class ConversationService {
  private readonly logger = Logger.child({ source: 'ConversationService' });
  private activeWriters: Map<string, WritableStreamDefaultWriter<StreamChunk>> =
    new Map();

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
      finalConfig.agent = AgentIds.CHAT;
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

  async saveMessage(
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

  async cancelStream(messageId: string, reason?: string): Promise<boolean> {
    const writer = this.activeWriters.get(messageId);

    if (!writer) return false;

    try {
      await writer.abort(new Error(reason ?? 'Cancelled by user'));
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to cancel stream for message ${messageId}:`,
        error,
      );
      return false;
    }
  }

  async createStreamForMessage(
    conversationId: string,
    message: Message,
  ): Promise<WritableStreamDefaultWriter<StreamChunk>> {
    const startTime = Date.now();
    let firstChunkReceived = false;

    const queue = new PQueue({
      interval: 30,
      intervalCap: 1,
      concurrency: 1,
    });

    const enqueueDelta = (delta: string) => {
      const charsPerChunk = 2;
      for (let i = 0; i < delta.length; i += charsPerChunk) {
        queue.add(() =>
          this.sseService.sendToConversation(conversationId, {
            type: 'completion_delta',
            content: delta.slice(i, i + charsPerChunk),
            meta: message.meta!,
          }),
        );
      }
    };

    const writableStream = new WritableStream<StreamChunk>({
      write: async (chunk: StreamChunk) => {
        const data = typeof chunk === 'string' ? { content: chunk } : chunk;

        message.content += data.content ?? '';
        message.meta = { ...message.meta, ...data.meta };

        if (!firstChunkReceived && data.content) {
          firstChunkReceived = true;
          message.meta = {
            ...message.meta,
            loading: false,
            streaming: true,
          };

          this.logger.info(
            `First chunk received for agent call in conversation ${conversationId}, time taken: ${Date.now() - startTime}ms`,
          );
        }

        if (data.meta) {
          await queue.onIdle();
        }

        enqueueDelta(data.content ?? '');
      },
      close: async () => {
        this.activeWriters.delete(message.id);

        try {
          await this.saveMessage(
            message.id,
            message.content,
            omit(message.meta, ['loading', 'streaming']),
          );
        } catch (error) {
          this.logger.error('Failed to finalize streaming message:', error);
        }

        const elapsed = Date.now() - startTime;
        this.logger.info(
          `Agent call finished for conversation ${conversationId}, total time: ${elapsed}ms, time per token: ${
            elapsed / (message.content.length || 1)
          }ms`,
        );

        await queue.onIdle();

        this.sseService.sendToConversation(conversationId, {
          type: 'completion_done',
        });
      },
      abort: async (reason: unknown) => {
        this.activeWriters.delete(message.id);
        queue.clear();

        this.logger.error(
          `Streaming aborted for conversation ${conversationId}:`,
          reason,
        );

        const content = (reason as Error)?.message || `Aborted`;
        try {
          await this.saveMessage(message.id, content, {
            ...message.meta,
            loading: undefined,
            streaming: undefined,
            error: true,
          });
        } catch (error) {
          this.logger.error('Failed to finalize streaming message:', error);
        }

        this.sseService.sendToConversation(conversationId, {
          type: 'completion_error',
          error: content,
        });
      },
    });

    this.logger.info(`Created writable stream for message ${message.id}`);

    const writer = writableStream.getWriter();
    this.activeWriters.set(message.id, writer);

    return writer;
  }
}
