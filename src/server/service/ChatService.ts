import { MemoryIds, RedisKeys } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import type { MessageAttachment } from '@/shared/types/entities';
import { globby } from 'globby';
import { container, inject } from 'tsyringe';
import type { Agent } from '../core/agent';
import { ChatSession, SessionPhase } from '../core/ChatSession';
import { Memory } from '../core/memory';
import { registerMemory } from '../decorator/core';
import { service } from '../decorator/service';
import { isProd } from '../utils';
import Logger from '../utils/logger';
import { RedisService } from './RedisService';
import dayjs from 'dayjs';

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

  constructor(@inject(RedisService) private redisService: RedisService) {
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
    return this.redisService.get<ChatSessionState>(
      RedisKeys.CHAT_SESSION(conversationId),
    );
  }

  async updateSessionPhase(
    conversationId: string,
    phase: SessionPhase,
    agentId?: string,
  ): Promise<void> {
    const state = await this.getSessionState(conversationId);
    if (!state) return;
    await this.redisService.set(
      RedisKeys.CHAT_SESSION(conversationId),
      { ...state, phase, agentId: agentId ?? state.agentId },
      3600,
    );
  }

  /**
   * Acquire or retrieve an existing session with distributed lock.
   * Returns null if lock acquisition fails (another request is creating session).
   */
  async acquireSession(conversationId: string): Promise<ChatSession | null> {
    // Check existing session first (fast path, no lock needed)
    const existing = this.sessions.get(conversationId);
    if (existing) {
      this.logger.info(`Session reconnected`, {
        sessionId: conversationId,
        phase: existing.phase,
      });
      return existing;
    }

    // Try to acquire distributed lock
    const lockKey = RedisKeys.CHAT_SESSION_LOCK(conversationId);
    const lockAcquired = await this.redisService.acquireLock(lockKey, 5);

    if (!lockAcquired) {
      this.logger.warn(`Failed to acquire lock for ${conversationId}`);
      return null;
    }

    try {
      // Double-check after acquiring lock
      const existingAfterLock = this.sessions.get(conversationId);
      if (existingAfterLock) {
        return existingAfterLock;
      }

      this.logger.info(`Session created`, { sessionId: conversationId });

      const session = new ChatSession(conversationId, {
        idleTimeoutMs: 30_000,
        onDispose: async (id: string) => {
          this.sessions.delete(id);
          await this.redisService.del(RedisKeys.CHAT_SESSION(id));
          await this.redisService.del(RedisKeys.HUMAN_INPUT(id));
        },
        onPhaseChange: async (id: string, phase: SessionPhase) => {
          await this.updateSessionPhase(id, phase);
        },
      });

      this.sessions.set(conversationId, session);

      // Persist session state to Redis for reconnection support
      await this.redisService.set(
        RedisKeys.CHAT_SESSION(conversationId),
        {
          conversationId,
          phase: 'waiting',
          startedAt: Date.now(),
          agentId: null,
        },
        3600,
      );

      return session;
    } finally {
      // Always release lock
      await this.redisService.releaseLock(lockKey);
    }
  }

  /**
   * Start a new session for backend-initiated agents.
   * This is for scenarios where the backend starts the agent first,
   * then the frontend connects via SSE later.
   */
  async startSession(conversationId: string): Promise<ChatSession> {
    // Check existing session first
    const existing = this.sessions.get(conversationId);
    if (existing) {
      this.logger.warn(`Session already exists for ${conversationId}`, {
        phase: existing.phase,
      });
      return existing;
    }

    this.logger.info(`Session started (backend-initiated)`, {
      sessionId: conversationId,
    });

    const session = new ChatSession(conversationId, {
      idleTimeoutMs: 30_000,
      onDispose: async (id: string) => {
        this.sessions.delete(id);
        await this.redisService.del(RedisKeys.CHAT_SESSION(id));
        await this.redisService.del(RedisKeys.HUMAN_INPUT(id));
      },
      onPhaseChange: async (id: string, phase: SessionPhase) => {
        await this.updateSessionPhase(id, phase);
      },
    });

    this.sessions.set(conversationId, session);

    // Persist session state to Redis for reconnection support
    await this.redisService.set(
      RedisKeys.CHAT_SESSION(conversationId),
      {
        conversationId,
        phase: 'waiting',
        startedAt: Date.now(),
        agentId: null,
      },
      3600,
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
      await session.cleanup();
    }
  }

  async buildMemory(
    agent: Agent,
    conversationId: string,
    userId: string,
    config: Record<string, any>,
    userMessage: {
      role: Role;
      content: string;
      attachments?: MessageAttachment[] | null;
      meta?: Record<string, any> | null;
    },
  ): Promise<Memory> {
    const memory = container.resolve<Memory>(
      config?.memory?.type ?? MemoryIds.NONE,
    );

    memory.setConversationId(conversationId);
    memory.setUserId(userId);

    const messages = await memory.summarize();
    const chatMessages = this.buildChatMessages({
      agent,
      conversationId,
      userId,
      userMessage,
      isNewConversation: messages.length === 0,
    });

    await memory.store(chatMessages);

    this.logger.debug('Memory built', {
      sessionId: conversationId,
      messageCount: chatMessages.length,
    });

    return memory;
  }

  private buildChatMessages({
    agent,
    conversationId,
    userId,
    userMessage,
    isNewConversation,
  }: {
    agent: Agent;
    conversationId: string;
    userId: string;
    userMessage: {
      role: Role;
      content: string;
      attachments?: MessageAttachment[] | null;
      meta?: Record<string, any> | null;
    };
    isNewConversation: boolean;
  }): {
    role: Role;
    content: string;
    attachments?: MessageAttachment[] | null;
    meta?: Record<string, any> | null;
    createdAt: Date;
  }[] {
    const baseTime = Date.now();
    const messages: {
      role: Role;
      content: string;
      attachments?: MessageAttachment[] | null;
      meta?: Record<string, any> | null;
      createdAt: Date;
    }[] = [];

    // Add system prompt for new conversations
    if (isNewConversation) {
      const systemPrompt = agent.systemPrompt.build();

      if (systemPrompt) {
        messages.push({
          role: Role.SYSTEM,
          content: systemPrompt,
          createdAt: new Date(baseTime + messages.length),
        });
      }
    }

    // Add session context as a user message before the actual user message
    // Only add for new conversations to avoid duplication
    if (isNewConversation) {
      const sessionContext = `<session-context>
Conversation ID: ${conversationId}
User ID: ${userId}
Current Time: ${dayjs().format('YYYY-MM-DD HH:mm:ss')}
</session-context>`;

      messages.push({
        role: Role.USER,
        content: sessionContext,
        meta: { hidden: true },
        createdAt: new Date(baseTime + messages.length),
      });
    }

    // Add user message
    messages.push({
      ...userMessage,
      createdAt: new Date(baseTime + messages.length),
    });

    return messages;
  }
}
