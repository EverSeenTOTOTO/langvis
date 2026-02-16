import { Role } from '@/shared/entities/Message';
import type { Conversation } from '@/shared/types/entities';
import type { Request } from 'express';
import { globby } from 'globby';
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
  private activeAgents: Map<string, ExecutionContext> = new Map();

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
    const ctx = this.activeAgents.get(conversationId);

    if (!ctx) return false;

    try {
      ctx.abort(reason ?? 'Cancelled by user');
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
    conversation: Conversation,
    agent: Agent,
    memory: Memory,
  ): Promise<void> {
    const startTime = Date.now();
    let firstTokenTime: number | undefined = undefined;

    const [assistantMessage] = await this.conversationService.batchAddMessages(
      conversation.id!,
      [
        {
          role: Role.ASSIST,
          content: '',
          createdAt: new Date(),
        },
      ],
    );

    const controller = new AbortController();
    const ctx = ExecutionContext.create(assistantMessage, controller);

    this.activeAgents.set(conversation.id!, ctx);

    try {
      const generator = agent.call(memory, ctx, conversation.config);

      for await (const event of generator) {
        if (ctx.signal.aborted) {
          throw new Error(`Aborted: ${ctx.signal.reason}`);
        }

        if (event.type === 'stream' && !firstTokenTime) {
          firstTokenTime = Date.now();
        }

        if (event.type === 'error') {
          throw new Error(event.error);
        }

        this.sseService.sendToConversation(conversation.id!, event);
      }

      await this.finalizeMessage(
        conversation.id!,
        ctx,
        startTime,
        firstTokenTime,
      );
    } catch (error) {
      await this.handleStreamError(conversation.id!, ctx, error);
    } finally {
      this.activeAgents.delete(conversation.id!);
    }
  }

  private async finalizeMessage(
    conversationId: string,
    ctx: ExecutionContext,
    startTime: number,
    firstTokenTime?: number,
  ): Promise<void> {
    const totalTime = Date.now() - startTime;
    const ttft = firstTokenTime ? firstTokenTime - startTime : null;
    const avgPerTokenTime = totalTime / ctx.content.length;

    await this.conversationService.updateMessage(ctx.traceId, ctx.content, {
      events: ctx.events,
    });

    this.logger.info(
      `Agent call finished for conversation ${conversationId}, ` +
        `total time: ${totalTime}ms, ` +
        `tokens: ${ctx.content.length}, ` +
        `TTFT: ${ttft ?? 'N/A'}ms, ` +
        `avg per token: ${avgPerTokenTime.toFixed(2)}ms`,
    );
  }

  private async handleStreamError(
    conversationId: string,
    ctx: ExecutionContext,
    error: unknown,
  ): Promise<void> {
    const errorMessage = (error as Error)?.message || 'Unknown error';

    try {
      await this.conversationService.updateMessage(ctx.traceId, errorMessage, {
        events: ctx.events,
        error: true,
      });
    } catch (updateError) {
      this.logger.error('Failed to finalize streaming message:', updateError);
    }

    this.sseService.sendToConversation(
      conversationId,
      ctx.agentErrorEvent(errorMessage),
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

    const chatMessages: {
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
        chatMessages.push({
          role: Role.SYSTEM,
          content: systemPrompt,
          createdAt: new Date(),
        });
      }
    }

    // Add user message
    chatMessages.push({
      ...userMessage,
      createdAt: new Date(),
    });

    await memory.store(chatMessages);

    return memory;
  }
}
