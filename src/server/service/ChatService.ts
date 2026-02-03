import { Message, Role } from '@/shared/entities/Message';
import { StreamChunk } from '@/shared/types';
import type { Request } from 'express';
import { globby } from 'globby';
import { omit } from 'lodash-es';
import PQueue from 'p-queue';
import { container, inject } from 'tsyringe';
import { Agent } from '../core/agent';
import { Memory } from '../core/memory';
import { registerMemory } from '../decorator/core';
import { service } from '../decorator/service';
import { isProd } from '../utils';
import Logger from '../utils/logger';
import { AuthService } from './AuthService';
import { ConversationService } from './ConversationService';
import { SSEService } from './SSEService';

@service()
export class ChatService {
  private readonly logger = Logger.child({ source: 'ChatService' });
  private activeAgents: Map<string, AbortController> = new Map();

  constructor(
    @inject(SSEService)
    private sseService: SSEService,

    @inject(AuthService)
    private authService: AuthService,

    @inject(ConversationService)
    private conversationService: ConversationService,
  ) {
    const suffix = isProd ? '.js' : '.ts';
    const pattern = `./${isProd ? 'dist' : 'src'}/server/core/memory/*/index${suffix}`;

    globby(pattern, {
      cwd: process.cwd(),
      absolute: true,
    })
      .then(memoryPaths => {
        return Promise.all(
          memoryPaths.map(async memoryPath => {
            const { default: clazz } = await import(memoryPath);

            registerMemory(clazz);
          }),
        );
      })
      .catch(error => {
        this.logger.error('Failed to register memory modules:', error);
      });
  }

  async cancelAgent(conversationId: string, reason?: string): Promise<boolean> {
    const controller = this.activeAgents.get(conversationId);

    if (!controller) return false;

    try {
      controller.abort(new Error(reason ?? 'Cancelled by user'));
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to cancel agent for conversation ${conversationId}:`,
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
      `Upstream stream closed for conversation ${context.conversationId}, transmit time: ${chunkElapsed}ms, time per token: ${
        chunkElapsed / (context.message.content.length || 1)
      }ms`,
    );

    try {
      await context.queue.onIdle();
      this.activeAgents.delete(context.conversationId);
      await this.conversationService.updateMessage(
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
    this.activeAgents.delete(context.conversationId);

    this.logger.error(
      `Streaming aborted for conversation ${context.conversationId}:`,
      reason,
    );

    const content = (reason as Error)?.message || `Aborted`;
    try {
      await this.conversationService.updateMessage(
        context.message.id,
        content,
        {
          ...context.message.meta,
          loading: undefined,
          streaming: undefined,
          error: true,
        },
      );
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
    controller: AbortController,
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
    this.activeAgents.set(conversationId, controller);

    controller.signal.addEventListener('abort', () => {
      writer.abort(controller.signal.reason);
    });

    return writer;
  }

  async buildMemory(
    req: Request,
    agent: Agent,
    config: Record<string, any>,
    userMessage: {
      role: Role;
      content: string;
      meta?: Record<string, any> | null;
    },
  ): Promise<Memory> {
    const { conversationId } = req.params;
    const currentUserId = await this.authService.getUserId(req);

    const memory = container.resolve<Memory>(config?.memory?.type);

    memory.setConversationId(conversationId);
    memory.setUserId(currentUserId);

    const baseTimestamp = Date.now();
    const initMessages: {
      role: Role;
      content: string;
      meta?: Record<string, any> | null;
      createdAt: Date;
    }[] = [];
    const messages = await memory.summarize();

    let timestampOffset = 0;

    // Add system prompt if needed
    if (typeof agent.getSystemPrompt === 'function' && messages.length == 0) {
      const systemPrompt = await agent.getSystemPrompt();
      if (systemPrompt) {
        initMessages.push({
          role: Role.SYSTEM,
          content: systemPrompt,
          createdAt: new Date(baseTimestamp + timestampOffset++),
        });
      }
    }

    // Add user message
    initMessages.push({
      ...userMessage,
      createdAt: new Date(baseTimestamp + timestampOffset++),
    });

    await memory.store(initMessages);

    return memory;
  }
}
