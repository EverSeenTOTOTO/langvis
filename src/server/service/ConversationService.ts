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
  private activeWriters: Map<
    string,
    { writer: WritableStreamDefaultWriter<StreamChunk>; queue: PQueue }
  > = new Map();

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
    const active = this.activeWriters.get(messageId);

    if (!active) return false;

    try {
      active.queue.clear();
      await active.writer.abort(new Error(reason ?? 'Cancelled by user'));
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to cancel stream for message ${messageId}:`,
        error,
      );
      return false;
    }
  }

  private enqueueDelta(
    context: {
      queue: PQueue;
      conversationId: string;
      message: Message;
    },
    delta: string,
  ) {
    const charsPerChunk = 2;
    for (let i = 0; i < delta.length; i += charsPerChunk) {
      context.queue.add(() =>
        this.sseService.sendToConversation(context.conversationId, {
          type: 'completion_delta',
          content: delta.slice(i, i + charsPerChunk),
          meta: context.message.meta!,
        }),
      );
    }
  }

  private async handleStreamWrite(
    chunk: StreamChunk,
    context: {
      message: Message;
      conversationId: string;
      queue: PQueue;
      firstWrite: boolean;
      startTime: number;
      chunkStartTime: number;
    },
  ): Promise<void> {
    if (context.firstWrite) {
      this.logger.info(
        `First write for conversation ${context.conversationId}, time taken: ${Date.now() - context.startTime}ms`,
      );
    }

    const data = typeof chunk === 'string' ? { content: chunk } : chunk;

    if (!context.message.content && data.content) {
      this.logger.info(
        `First chunk received for conversation ${context.conversationId}, time taken: ${Date.now() - context.startTime}ms`,
      );
      context.chunkStartTime = Date.now();
      context.message.meta = {
        ...context.message.meta,
        streaming: true,
      };
    }

    context.message.content += data.content ?? '';
    context.message.meta = {
      ...context.message.meta,
      ...data.meta,
      loading: false,
    };

    if (context.firstWrite || data.meta) {
      await context.queue.onIdle(); // meta 变化通常意味着特殊渲染内容，清空队列有利于避免绘制错乱
      this.sseService.sendToConversation(context.conversationId, {
        type: 'completion_delta',
        meta: context.message.meta!,
      });
    }

    if (data.content) {
      this.enqueueDelta(context, data.content);
    }

    context.firstWrite = false;
  }

  private async handleStreamClose(context: {
    message: Message;
    conversationId: string;
    queue: PQueue;
    startTime: number;
    chunkStartTime: number;
  }): Promise<void> {
    const chunkElapsed = Date.now() - context.chunkStartTime;
    this.logger.info(
      `Upstream stream closed for conversation ${context.conversationId}, transmit time: ${chunkElapsed}, time per token: ${
        chunkElapsed / (context.message.content.length || 1)
      }`,
    );

    try {
      await context.queue.onIdle();
      this.activeWriters.delete(context.message.id);
      await this.saveMessage(
        context.message.id,
        context.message.content,
        omit(context.message.meta, ['loading', 'streaming']),
      );
    } catch (error) {
      this.logger.error('Failed to finalize streaming message:', error);
    }

    this.logger.info(
      `Agent call finished for conversation ${context.conversationId}, total time: ${Date.now() - context.startTime}ms`,
    );

    this.sseService.sendToConversation(context.conversationId, {
      type: 'completion_done',
    });
  }

  private async handleStreamAbort(
    reason: unknown,
    context: {
      message: Message;
      conversationId: string;
      queue: PQueue;
    },
  ): Promise<void> {
    context.queue.clear();
    this.activeWriters.delete(context.message.id);

    this.logger.error(
      `Streaming aborted for conversation ${context.conversationId}:`,
      reason,
    );

    const content = (reason as Error)?.message || `Aborted`;
    try {
      await this.saveMessage(context.message.id, content, {
        ...context.message.meta,
        loading: undefined,
        streaming: undefined,
        error: true,
      });
    } catch (error) {
      this.logger.error('Failed to finalize streaming message:', error);
    }

    this.sseService.sendToConversation(context.conversationId, {
      type: 'completion_error',
      error: content,
    });
  }

  async createStreamForMessage(
    conversationId: string,
    message: Message,
  ): Promise<WritableStreamDefaultWriter<StreamChunk>> {
    const context = {
      message,
      conversationId,
      queue: new PQueue({
        interval: 30,
        intervalCap: 1,
        concurrency: 1,
      }),
      startTime: Date.now(),
      firstWrite: true,
      chunkStartTime: Date.now(),
    };

    const writableStream = new WritableStream<StreamChunk>({
      write: (chunk: StreamChunk) => this.handleStreamWrite(chunk, context),
      close: () => this.handleStreamClose(context),
      abort: (reason: unknown) => this.handleStreamAbort(reason, context),
    });

    this.logger.info(`Created writable stream for message ${message.id}`);

    const writer = writableStream.getWriter();
    this.activeWriters.set(message.id, {
      writer,
      queue: context.queue,
    });

    return writer;
  }
}

