import { Role } from '@/shared/entities/Message';
import type { Conversation } from '@/shared/types/entities';
import type { Request } from 'express';
import { globby } from 'globby';
import { container, inject } from 'tsyringe';
import type { Agent } from '../core/agent';
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

  async startAgent(
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
    const ctx = new ExecutionContext(assistantMessage, controller);

    this.activeAgents.set(conversation.id!, ctx);

    try {
      const generator = agent.call(memory, ctx, conversation.config);

      for await (const event of generator) {
        if (ctx.signal.aborted) {
          break;
        }

        if (event.type === 'stream' && !firstTokenTime) {
          firstTokenTime = Date.now();
        }

        this.sseService.sendToConversation(conversation.id!, event);

        if (event.type === 'error') {
          break;
        }
      }
    } catch (err) {
      const errorEvent = ctx.agentErrorEvent(
        (err as Error)?.message || String(err),
      );
      this.sseService.sendToConversation(conversation.id!, errorEvent);
    } finally {
      try {
        await this.finalizeMessage(
          conversation.id!,
          ctx,
          startTime,
          firstTokenTime,
        );
      } catch (finalizeError) {
        this.logger.error(
          `Failed to save message for conversation ${conversation.id}:`,
          finalizeError,
        );
      }

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
    const avgPerTokenTime = totalTime / ctx.message.content.length;

    await this.conversationService.updateMessage(
      ctx.message.id,
      ctx.message.content,
      ctx.message.meta,
    );

    this.logger.info(
      `Agent call finished for conversation ${conversationId}, ` +
        `total time: ${totalTime}ms, ` +
        `tokens: ${ctx.message.content.length}, ` +
        `TTFT: ${ttft ?? 'N/A'}ms, ` +
        `avg per token: ${avgPerTokenTime.toFixed(2)}ms`,
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
