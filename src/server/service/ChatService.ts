import { InjectTokens } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';
import type { Request } from 'express';
import { globby } from 'globby';
import type { RedisClientType } from 'redis';
import { container, inject } from 'tsyringe';
import type { Agent } from '../core/agent';
import { ChatSession } from '../core/ChatSession';
import { Memory } from '../core/memory';
import { registerMemory } from '../decorator/core';
import { service } from '../decorator/service';
import { isProd } from '../utils';
import Logger from '../utils/logger';
import { AuthService } from './AuthService';
import { ConversationService } from './ConversationService';

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

  async runSession(
    session: ChatSession,
    agent: Agent,
    memory: Memory,
    assistantMessage: Message,
    config: unknown,
  ): Promise<void> {
    this.logger.info(`Starting agent=${agent.id}`, {
      sessionId: session.conversationId,
    });

    try {
      await session.run(
        agent,
        memory,
        assistantMessage,
        config,
        this.finalizeMessage.bind(this),
      );
    } catch (err) {
      const errorMsg = (err as Error)?.message || String(err);
      this.logger.error(`Infrastructure error: ${errorMsg}`, {
        sessionId: session.conversationId,
      });
      session.send({ type: 'session_error', error: errorMsg });
      session.cleanup();
    }
  }

  private async finalizeMessage(message: Message): Promise<void> {
    await this.conversationService.updateMessage(
      message.id,
      message.content,
      message.meta,
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
    if (messages.length === 0) {
      const systemPrompt = agent.systemPrompt
        .with(
          'Background',
          `${conversationId ? `Conversation ID: ${conversationId}\n` : ''}${currentUserId ? `User ID: ${currentUserId}` : ''}`.trim(),
        )
        .build();

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
