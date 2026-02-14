import { Message, Role } from '@/shared/entities/Message';
import type { Request } from 'express';
import { globby } from 'globby';
import { omit } from 'lodash-es';
import { container, inject } from 'tsyringe';
import { Agent } from '../core/agent';
import { ExecutionContext } from '../core/context';
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

  async consumeAgentStream(
    conversationId: string,
    message: Message,
    agent: Agent,
    memory: Memory,
    config: Record<string, unknown>,
    traceId: string,
  ): Promise<void> {
    const startTime = Date.now();
    const controller = new AbortController();

    this.activeAgents.set(conversationId, controller);

    const ctx = ExecutionContext.create(traceId, controller.signal);

    try {
      const generator = agent.call(memory, ctx, config);

      for await (const event of generator) {
        if (controller.signal.aborted) {
          break;
        }

        if (event.type === 'stream') {
          message.content += event.content;
        } else if (event.type === 'error') {
          throw new Error(event.error);
        }

        this.sseService.sendToConversation(conversationId, event);
      }

      await this.finalizeMessage(conversationId, message, startTime);
    } catch (error) {
      await this.handleStreamError(conversationId, message, error, ctx);
    } finally {
      this.activeAgents.delete(conversationId);
    }
  }

  private async finalizeMessage(
    conversationId: string,
    message: Message,
    startTime: number,
  ): Promise<void> {
    await this.conversationService.updateMessage(
      message.id,
      message.content,
      omit(message.meta, ['loading', 'streaming']),
    );

    this.logger.info(
      `Agent call finished for conversation ${conversationId}, total time: ${
        Date.now() - startTime
      }ms`,
    );
  }

  private async handleStreamError(
    conversationId: string,
    message: Message,
    error: unknown,
    ctx: ExecutionContext,
  ): Promise<void> {
    this.logger.error(
      `Streaming error for conversation ${conversationId}:`,
      error,
    );

    const errorMessage = (error as Error)?.message || 'Unknown error';
    try {
      await this.conversationService.updateMessage(message.id, errorMessage, {
        ...message.meta,
        loading: undefined,
        streaming: undefined,
        error: true,
      });
    } catch (updateError) {
      this.logger.error('Failed to finalize streaming message:', updateError);
    }

    this.sseService.sendToConversation(
      conversationId,
      ctx.agentEvent({ type: 'error', error: errorMessage }),
    );
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

    const initMessages: {
      role: Role;
      content: string;
      meta?: Record<string, any> | null;
      createdAt: Date;
    }[] = [];
    const messages = await memory.summarize();

    // Add system prompt if needed
    if (typeof agent.getSystemPrompt === 'function' && messages.length == 0) {
      const systemPrompt = await agent.getSystemPrompt();
      if (systemPrompt) {
        initMessages.push({
          role: Role.SYSTEM,
          content: systemPrompt,
          createdAt: new Date(),
        });
      }
    }

    // Add user message
    initMessages.push({
      ...userMessage,
      createdAt: new Date(),
    });

    await memory.store(initMessages);

    return memory;
  }
}
