import { InjectTokens, MemoryIds, RedisKeys } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import { globby } from 'globby';
import type { RedisClientType } from 'redis';
import { container, inject } from 'tsyringe';
import type { Agent } from '../core/agent';
import { ChatSession, SessionPhase } from '../core/ChatSession';
import { Memory } from '../core/memory';
import { registerMemory } from '../decorator/core';
import { service } from '../decorator/service';
import { isProd } from '../utils';
import Logger from '../utils/logger';
import { ConversationService } from './ConversationService';

/**
 * Session state persisted to Redis for reconnection support.
 * Allows cross-instance/session restart recovery.
 */
export interface ChatSessionState {
  conversationId: string;
  phase: SessionPhase;
  startedAt: number;
  agentId: string | null;
}

@service()
export class ChatService {
  private readonly logger = Logger.child({ source: 'ChatService' });
  private sessions = new Map<string, ChatSession>();

  constructor(
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

  async getSessionState(
    conversationId: string,
  ): Promise<ChatSessionState | null> {
    const data = await this.redis.get(RedisKeys.CHAT_SESSION(conversationId));
    return data ? JSON.parse(data) : null;
  }

  async updateSessionPhase(
    conversationId: string,
    phase: SessionPhase,
    agentId?: string,
  ): Promise<void> {
    const state = await this.getSessionState(conversationId);
    if (!state) return;
    await this.redis.set(
      RedisKeys.CHAT_SESSION(conversationId),
      JSON.stringify({ ...state, phase, agentId: agentId ?? state.agentId }),
      { EX: 3600 },
    );
  }

  acquireSession(conversationId: string): ChatSession | null {
    const existing = this.sessions.get(conversationId);
    // Allow reconnection for existing session (both waiting and running)
    if (existing) {
      this.logger.info(`Session reconnected`, {
        sessionId: conversationId,
        phase: existing.phase,
      });
      return existing;
    }

    this.logger.info(`Session created`, { sessionId: conversationId });

    const session = new ChatSession(conversationId, {
      idleTimeoutMs: 30_000,
      onDispose: async (id: string) => {
        this.sessions.delete(id);
        await this.redis.del(RedisKeys.CHAT_SESSION(id));
        await this.redis.del(RedisKeys.HUMAN_INPUT(id));
      },
      onPhaseChange: async (id: string, phase: SessionPhase) => {
        await this.updateSessionPhase(id, phase);
      },
    });

    this.sessions.set(conversationId, session);

    // Persist session state to Redis for reconnection support
    this.redis
      .set(
        RedisKeys.CHAT_SESSION(conversationId),
        JSON.stringify({
          conversationId,
          phase: 'waiting',
          startedAt: Date.now(),
          agentId: null,
        }),
        { EX: 3600 },
      )
      .catch(err =>
        this.logger.error(
          `Failed to save session state for ${conversationId}:`,
          err,
        ),
      );

    return session;
  }

  async runSession(
    session: ChatSession,
    agent: Agent,
    memory: Memory,
    config: unknown,
  ): Promise<void> {
    this.logger.info(`Starting agent=${agent.id}`, {
      sessionId: session.conversationId,
    });

    try {
      await session.run(agent, memory, config);
    } catch (err) {
      const errorMsg = (err as Error)?.message || String(err);
      this.logger.error(`Infrastructure error: ${errorMsg}`, {
        sessionId: session.conversationId,
      });
      session.send({ type: 'session_error', error: errorMsg });
      session.cleanup();
    }
  }

  async buildMemory(
    conversationId: string,
    userId: string,
    agent: Agent,
    config: Record<string, any>,
    userMessage?: {
      role: Role;
      content: string;
      meta?: Record<string, any> | null;
    },
  ): Promise<Memory> {
    const memory = container.resolve<Memory>(
      config?.memory?.type ?? MemoryIds.NONE,
    );

    memory.setConversationId(conversationId);
    memory.setUserId(userId);

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
          `Conversation ID: ${conversationId}\nUser ID: ${userId}`,
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

    // Add user message if provided (for frontend-triggered chats)
    if (userMessage) {
      chatMessages.push({
        ...userMessage,
        createdAt: new Date(baseTime + timeOffset),
      });
    } else {
      // Otherwise, load existing messages from database (for backend-triggered sessions)
      const existingMessages =
        await this.conversationService.getMessagesByConversationId(
          conversationId,
        );
      for (const msg of existingMessages) {
        if (msg.role === Role.USER) {
          chatMessages.push({
            role: msg.role,
            content: msg.content,
            meta: msg.meta,
            createdAt: new Date(baseTime + timeOffset++),
          });
        }
      }
    }

    await memory.store(chatMessages);

    this.logger.debug('Memory built', {
      sessionId: conversationId,
      messageCount: chatMessages.length,
    });

    return memory;
  }
}
