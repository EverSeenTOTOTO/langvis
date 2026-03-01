import { InjectTokens } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import type { Conversation, Message } from '@/shared/types/entities';
import type { Request } from 'express';
import { globby } from 'globby';
import type { RedisClientType } from 'redis';
import { container, inject } from 'tsyringe';
import type { Agent } from '../core/agent';
import { ChatSession } from '../core/ChatSession';
import { ExecutionContext } from '../core/context';
import { Memory } from '../core/memory';
import { registerMemory } from '../decorator/core';
import { service } from '../decorator/service';
import { isProd } from '../utils';
import Logger from '../utils/logger';
import { AuthService } from './AuthService';
import { ConversationService } from './ConversationService';
import chalk from 'chalk';

@service()
export class ChatService {
  private readonly logger = Logger.child({ source: 'ChatService' });
  private sessions = new Map<string, ChatSession>();

  constructor(
    @inject(AuthService)
    private authService: AuthService,

    @inject(ConversationService)
    private conversationService: ConversationService,

    @inject(InjectTokens.REDIS)
    private redis: RedisClientType<any>,
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

  getSession(conversationId: string): ChatSession | undefined {
    return this.sessions.get(conversationId);
  }

  acquireSession(conversationId: string): ChatSession | null {
    const existing = this.sessions.get(conversationId);
    if (existing?.phase === 'running') return null;
    if (existing) existing.cleanup();

    const session = new ChatSession(conversationId, {
      idleTimeoutMs: 30_000,
      logger: this.logger,
      onDispose: (id: string) => {
        this.sessions.delete(id);
        this.redis.del(`human_input:${id}`).catch(err => {
          this.logger.warn(`Failed to clean Redis key for ${id}:`, err);
        });
      },
    });

    this.sessions.set(conversationId, session);
    return session;
  }

  async startAgent(
    session: ChatSession,
    conversation: Conversation,
    agent: Agent,
    memory: Memory,
    assistantMessage: Message,
  ): Promise<void> {
    const sessionId = session.conversationId;
    this.logger.info(`Starting agent=${chalk.cyan(agent.id)}`, { sessionId });

    try {
      const controller = new AbortController();
      const ctx = new ExecutionContext(assistantMessage, controller);
      session.start(ctx);

      const startTime = Date.now();
      let firstTokenTime: number | undefined;

      try {
        for await (const event of agent.call(
          memory,
          ctx,
          conversation.config,
        )) {
          if (ctx.signal.aborted) break;

          if (event.type === 'stream' && !firstTokenTime) {
            firstTokenTime = Date.now();
            this.logger.info(
              `First token received: ttft=${chalk.green(`${firstTokenTime - startTime}ms`)} sessionId=${sessionId}`,
            );
          }

          if (!session.sendEvent(event)) {
            this.logger.warn(
              `SSE not writable for ${conversation.id}, aborting`,
            );
            ctx.abort('SSE connection lost');
            break;
          }

          if (event.type === 'error') break;
        }
      } catch (err) {
        this.logger.error(
          `Agent error: ${chalk.red((err as Error)?.message || String(err))}`,
          { sessionId },
        );
        const errorEvent = ctx.agentErrorEvent(
          (err as Error)?.message || String(err),
        );
        session.sendEvent(errorEvent);
      } finally {
        if (ctx.signal.aborted) {
          this.logger.info(
            `Agent cancelled: reason=${chalk.yellow((ctx.signal.reason as Error)?.message ?? 'Unknown')} sessionId=${sessionId}`,
          );
          const cancelledEvent = ctx.agentCancelledEvent(
            (ctx.signal.reason as Error)?.message ?? 'Unknown',
          );
          session.sendEvent(cancelledEvent);
        }

        await this.finalizeMessage(ctx);

        const totalTime = Date.now() - startTime;
        const ttft = firstTokenTime ? firstTokenTime - startTime : null;
        const avgTokenTime = totalTime / ctx.message.content.length;
        this.logger.info(
          `Agent completed: totalTime=${chalk.green(`${totalTime}ms`)} tokens=${chalk.green(ctx.message.content.length)} ttft=${ttft ? chalk.green(`${ttft}ms`) : 'N/A'} avgTokenTime=${chalk.green(`${avgTokenTime.toFixed(2)}ms`)} sessionId=${sessionId}`,
        );

        session.cleanup();
      }
    } catch (err) {
      // Outer catch: ctx not created yet, infrastructure error
      const errorMsg = (err as Error)?.message || String(err);
      this.logger.error(`Infrastructure error: ${chalk.red(errorMsg)}`, {
        sessionId,
      });
      session.sendControlMessage({ type: 'session_error', error: errorMsg });
      session.cleanup();
    }
  }

  private async finalizeMessage(ctx: ExecutionContext): Promise<void> {
    await this.conversationService.updateMessage(
      ctx.message.id,
      ctx.message.content,
      ctx.message.meta,
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

    const baseTime = Date.now();
    let timeOffset = 0;

    // Add system prompt if needed
    if (typeof agent.getSystemPrompt === 'function' && messages.length === 0) {
      const systemPrompt = await agent.getSystemPrompt();
      if (systemPrompt) {
        chatMessages.push({
          role: Role.SYSTEM,
          content: systemPrompt,
          createdAt: new Date(baseTime + timeOffset++),
        });
      }
    }

    // Add user message
    chatMessages.push({
      ...userMessage,
      createdAt: new Date(baseTime + timeOffset),
    });

    await memory.store(chatMessages);

    return memory;
  }
}
