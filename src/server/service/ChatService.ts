import { RedisKeys } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import type { MessageAttachment } from '@/shared/types/entities';
import { SessionPhase } from '@/shared/types';
import { generateId } from '@/shared/utils';
import { globby } from 'globby';
import { inject } from 'tsyringe';
import type { Agent } from '../core/agent';
import { MessageFSM } from '../core/MessageFSM';
import { SessionFSM } from '../core/SessionFSM';
import { registerMemory } from '../decorator/core';
import { service } from '../decorator/service';
import { isProd } from '../utils';
import Logger from '../utils/logger';
import { estimateTokens } from '../utils/estimateTokens';
import { ConversationService } from './ConversationService';
import { RedisService } from './RedisService';
import { ContextUsageService } from './ContextUsageService';
import { ProviderService } from './ProviderService';
import { WorkspaceService } from './WorkspaceService';
import dayjs from 'dayjs';

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

export interface PrepareTurnResult {
  /** Full conversation history including new turn messages */
  messages: import('@/shared/entities/Message').Message[];
  assistantId: string;
  /** The assistant placeholder message for this turn */
  assistantMessage: import('@/shared/entities/Message').Message;
}

@service()
export class ChatService {
  private readonly logger = Logger.child({ source: 'ChatService' });
  private sessions = new Map<string, SessionFSM>();

  constructor(
    @inject(RedisService) private redisService: RedisService,
    @inject(ConversationService)
    private conversationService: ConversationService,
    @inject(ContextUsageService)
    private contextUsageService: ContextUsageService,
    @inject(ProviderService) private providerService: ProviderService,
    @inject(WorkspaceService) private workspaceService: WorkspaceService,
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
      return false;
    }

    // Mark all zombie messages as error
    const errorEvent = {
      type: 'error' as const,
      messageId: 'zombie',
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

    // Return false to allow creating a new session
    return false;
  }

  /**
   * Prepare messages for a new turn: construct, pre-generate IDs, async persist.
   */
  async prepareTurn(params: {
    conversationId: string;
    userId: string;
    systemPrompt: string;
    context?: string;
    userMessage: {
      role: Role;
      content: string;
      attachments?: MessageAttachment[] | null;
      meta?: Record<string, any> | null;
    };
    assistantId?: string;
  }): Promise<PrepareTurnResult> {
    const {
      conversationId,
      userId,
      systemPrompt,
      context,
      userMessage,
      assistantId: preGeneratedAssistantId,
    } = params;

    // Load existing history
    const existingMessages =
      await this.conversationService.getMessagesByConversationId(
        conversationId,
      );
    const isFirstTurn = existingMessages.length === 0;

    const baseTime = Date.now();
    let index = 0;
    const newMessages: import('@/shared/entities/Message').Message[] = [];

    if (isFirstTurn) {
      // 1. System message
      newMessages.push({
        id: generateId('msg'),
        role: Role.SYSTEM,
        content: systemPrompt,
        attachments: null,
        meta: null,
        createdAt: new Date(baseTime + index++),
        conversationId,
      });

      // 2. Session context (hidden user message)
      const workDir = await this.workspaceService.getWorkDir(conversationId);
      const sessionContext = `<session-context>
Conversation ID: ${conversationId}
User ID: ${userId}
Current Time: ${dayjs().format('YYYY-MM-DD HH:mm:ss')}
Workspace Directory: ${workDir}
</session-context>`;

      newMessages.push({
        id: generateId('msg'),
        role: Role.USER,
        content: sessionContext,
        attachments: null,
        meta: { hidden: true },
        createdAt: new Date(baseTime + index++),
        conversationId,
      });

      // 3. Context (optional hidden user message)
      if (context) {
        newMessages.push({
          id: generateId('msg'),
          role: Role.USER,
          content: context,
          attachments: null,
          meta: { hidden: true },
          createdAt: new Date(baseTime + index++),
          conversationId,
        });
      }
    }

    // 4. User message
    newMessages.push({
      id: generateId('msg'),
      ...userMessage,
      createdAt: new Date(baseTime + index++),
      conversationId,
    });

    // 5. Assistant placeholder
    const assistantId = preGeneratedAssistantId ?? generateId('msg');
    const assistantMessage: import('@/shared/entities/Message').Message = {
      id: assistantId,
      role: Role.ASSIST,
      content: '',
      attachments: null,
      meta: null,
      createdAt: new Date(baseTime + index++),
      conversationId,
    };
    newMessages.push(assistantMessage);

    // 6. Async persist (fire and forget)
    this.conversationService
      .batchAddMessages(conversationId, newMessages)
      .catch(err => {
        this.logger.error('Failed to persist turn messages', err);
      });

    return {
      messages: [...existingMessages, ...newMessages],
      assistantId,
      assistantMessage,
    };
  }

  /**
   * Run agent execution loop, driving MessageFSM via events.
   */
  async runSession(
    session: SessionFSM,
    agent: Agent,
    config: unknown,
    messageId: string,
  ): Promise<void> {
    const messageFSM = session.getMessageFSM(messageId);
    if (!messageFSM) {
      this.logger.error(`MessageFSM not found for ${messageId}`);
      return;
    }

    const memory = session.memory;
    if (!memory) {
      this.logger.error(`Memory not set for session ${session.conversationId}`);
      return;
    }

    this.logger.info(`Starting agent=${agent.id}`, {
      sessionId: session.conversationId,
      messageId,
    });

    const startTime = Date.now();
    let firstTokenTime: number | undefined;

    try {
      for await (const event of agent.call(memory, messageFSM.ctx, config)) {
        if (messageFSM.ctx.signal.aborted) break;

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
      // If error is due to abort, don't treat as error - let finally handle cancel
      if (messageFSM.ctx.signal.aborted) {
        this.logger.info(
          `Agent execution aborted session=${session.conversationId}`,
        );
      } else {
        this.handleAgentError(err, messageFSM, session);
      }
    } finally {
      if (messageFSM.ctx.signal.aborted) {
        this.handleAgentCancel(messageFSM, session);
      }
      // Trigger memory turn-complete hook before persist
      // so that summaries can be persisted together with the message
      await memory.onTurnComplete(messageFSM.message);

      await messageFSM.persist();

      // Calculate context usage after persist (includes assistant reply)
      await messageFSM.ctx.pushContextUsage([
        ...(await memory.summarize()),
        messageFSM.message,
      ]);

      const totalTime = Date.now() - startTime;
      const ttft = firstTokenTime ? firstTokenTime - startTime : null;
      const contentLength = messageFSM.message.content.length;
      const avgTokenTime = contentLength > 0 ? totalTime / contentLength : 0;
      this.logger.info(
        `Agent completed: totalTime=${totalTime}ms tokens=${contentLength} ttft=${ttft ?? 'N/A'}ms avgTokenTime=${avgTokenTime.toFixed(2)}ms session=${session.conversationId}`,
      );
    }
  }

  /**
   * Setup context usage callback for ExecutionContext.
   * Agent/tool can call ctx.pushContextUsage(messages) to report context usage.
   */
  setupContextUsageCallback(
    session: SessionFSM,
    messageFSM: MessageFSM,
    modelId: string | undefined,
  ): void {
    if (!modelId) return;

    const model = this.providerService.getModel(modelId);
    if (!model?.contextSize) return;

    messageFSM.ctx.setOnPushContextUsage(async messages => {
      const memory = session.memory;
      if (!memory) return;

      try {
        const used = estimateTokens(messages, modelId);
        const total = model.contextSize!;

        // Store in context usage service
        this.contextUsageService.set(session.conversationId, { used, total });

        // Send context_usage event to client
        session.send({
          type: 'context_usage',
          messageId: messageFSM.messageId,
          used,
          total,
          seq: Date.now(),
          at: Date.now(),
        });

        // Notify memory of context usage change
        await memory.onContextUsageChange({ used, total });
      } catch (err) {
        this.logger.warn(
          `Failed to calculate context usage: ${(err as Error)?.message}`,
        );
      }
    });
  }

  private handleAgentError(
    err: unknown,
    messageFSM: MessageFSM,
    session: SessionFSM,
  ): void {
    this.logger.error(
      `Agent error: ${(err as Error)?.message || String(err)} session=${session.conversationId}`,
    );
    const errorEvent = messageFSM.ctx.agentErrorEvent(
      (err as Error)?.message || String(err),
    );
    messageFSM.handleEvent(errorEvent);
    session.send(errorEvent);
  }

  private handleAgentCancel(messageFSM: MessageFSM, session: SessionFSM): void {
    const reason =
      (messageFSM.ctx.signal.reason as Error)?.message ?? 'Unknown';
    this.logger.info(
      `Agent cancelled: ${reason} session=${session.conversationId}`,
    );
    const cancelledEvent = messageFSM.ctx.agentCancelledEvent(reason);
    // Send event BEFORE updating FSM state, otherwise cleanup may close SSE
    messageFSM.handleEvent(cancelledEvent);
    session.send(cancelledEvent);
  }
}
