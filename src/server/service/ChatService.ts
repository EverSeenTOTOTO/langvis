import { MemoryIds, RedisKeys } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import type { MessageAttachment } from '@/shared/types/entities';
import { globby } from 'globby';
import { container, inject } from 'tsyringe';
import type { Agent } from '../core/agent';
import { ExecutionContext } from '../core/ExecutionContext';
import { Memory } from '../core/memory';
import { MessageFSM } from '../core/MessageFSM';
import { SessionFSM, SessionPhase } from '../core/SessionFSM';
import { registerMemory } from '../decorator/core';
import { service } from '../decorator/service';
import { isProd } from '../utils';
import Logger from '../utils/logger';
import { ConversationService } from './ConversationService';
import { RedisService } from './RedisService';

/**
 * Session state persisted to Redis for reconnection support.
 */
export interface ChatSessionState {
  conversationId: string;
  phase: SessionPhase;
  messages: Array<{ messageId: string; phase: string }>;
  startedAt: number;
  agentId: string | null;
}

@service()
export class ChatService {
  private readonly logger = Logger.child({ source: 'ChatService' });
  private sessions = new Map<string, SessionFSM>();

  constructor(
    @inject(RedisService) private redisService: RedisService,
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

  getSession(conversationId: string): SessionFSM | undefined {
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
   */
  async acquireSession(conversationId: string): Promise<SessionFSM | null> {
    // Check existing session first (fast path)
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
      if (existingAfterLock) return existingAfterLock;

      // Check for zombie session (server restarted while agent was running)
      if (await this.detectAndCleanupZombie(conversationId)) {
        return null;
      }

      this.logger.info(`Session created`, { sessionId: conversationId });

      const session = new SessionFSM(conversationId, {
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

      // Persist session state to Redis
      await this.redisService.set(
        RedisKeys.CHAT_SESSION(conversationId),
        {
          conversationId,
          phase: 'waiting',
          messages: [],
          startedAt: Date.now(),
          agentId: null,
        },
        3600,
      );

      return session;
    } finally {
      await this.redisService.releaseLock(lockKey);
    }
  }

  /**
   * Detect and cleanup zombie session/message state after server restart.
   */
  async detectAndCleanupZombie(conversationId: string): Promise<boolean> {
    const state = await this.getSessionState(conversationId);

    // No Redis state = no zombie
    if (!state) return false;

    // Memory has session = not zombie
    if (this.sessions.has(conversationId)) return false;

    // done or waiting = safe to cleanup
    if (state.phase === 'done' || state.phase === 'waiting') {
      await this.redisService.del(RedisKeys.CHAT_SESSION(conversationId));
      await this.redisService.del(RedisKeys.HUMAN_INPUT(conversationId));
      return false;
    }

    // active / canceling / error + no memory = zombie
    this.logger.warn(`Zombie session detected`, {
      sessionId: conversationId,
      phase: state.phase,
    });

    // Find all non-terminal assistant messages
    const zombieMessages =
      await this.conversationService.findNonTerminalAssistantMessages(
        conversationId,
      );

    if (zombieMessages.length === 0) {
      // All messages have terminal state, safe cleanup
      await this.redisService.del(RedisKeys.CHAT_SESSION(conversationId));
      await this.redisService.del(RedisKeys.HUMAN_INPUT(conversationId));
      return false;
    }

    // Mark all zombie messages as error
    const errorEvent = {
      type: 'error' as const,
      error: 'Generation interrupted (server restarted)',
      seq: Date.now(),
      at: Date.now(),
    };

    await Promise.all(
      zombieMessages.map(msg => {
        const events = msg.meta?.events ?? [];
        events.push(errorEvent);
        return this.conversationService.updateMessage(
          msg.id,
          msg.content || 'Generation interrupted (server restarted)',
          { ...msg.meta, events },
        );
      }),
    );

    await this.redisService.del(RedisKeys.CHAT_SESSION(conversationId));
    await this.redisService.del(RedisKeys.HUMAN_INPUT(conversationId));

    return true;
  }

  /**
   * Run agent execution loop, driving MessageFSM via events.
   */
  async runSession(
    session: SessionFSM,
    agent: Agent,
    memory: Memory,
    config: unknown,
    messageId: string,
  ): Promise<void> {
    const messageFSM = session.getMessageFSM(messageId);
    if (!messageFSM) {
      this.logger.error(`MessageFSM not found for ${messageId}`);
      return;
    }

    this.logger.info(`Starting agent=${agent.id}`, {
      sessionId: session.conversationId,
      messageId,
    });

    const controller = new AbortController();
    const ctx = new ExecutionContext(controller);

    const startTime = Date.now();
    let firstTokenTime: number | undefined;

    try {
      for await (const event of agent.call(memory, ctx, config)) {
        if (ctx.signal.aborted) break;

        if (event.type === 'stream' && !firstTokenTime) {
          firstTokenTime = Date.now();
          this.logger.info(
            `First token: ttft=${firstTokenTime - startTime}ms session=${session.conversationId}`,
          );
        }

        // Update MessageFSM
        messageFSM.handleEvent(event);

        // Send via SSE
        if (!session.send(event)) {
          this.logger.warn(
            `SSE not connected for ${session.conversationId}, event persisted`,
          );
        }

        if (event.type === 'error') break;
      }
    } catch (err) {
      this.handleAgentError(err, ctx, messageFSM, session);
    } finally {
      await messageFSM.finalize(ctx);

      const totalTime = Date.now() - startTime;
      const ttft = firstTokenTime ? firstTokenTime - startTime : null;
      const contentLength = messageFSM.message.content.length;
      const avgTokenTime = contentLength > 0 ? totalTime / contentLength : 0;
      this.logger.info(
        `Agent completed: totalTime=${totalTime}ms tokens=${contentLength} ttft=${ttft ?? 'N/A'}ms avgTokenTime=${avgTokenTime.toFixed(2)}ms session=${session.conversationId}`,
      );

      await session.cleanup();
    }
  }

  private handleAgentError(
    err: unknown,
    ctx: ExecutionContext,
    messageFSM: MessageFSM,
    session: SessionFSM,
  ): void {
    this.logger.error(
      `Agent error: ${(err as Error)?.message || String(err)} session=${session.conversationId}`,
    );
    const errorEvent = ctx.agentErrorEvent(
      (err as Error)?.message || String(err),
    );
    messageFSM.handleEvent(errorEvent);
    session.send(errorEvent);
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
