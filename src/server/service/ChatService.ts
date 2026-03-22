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

    await memory.initialize({
      systemPrompt: agent.systemPrompt.build(),
      userMessage,
    });

    return memory;
  }
}
