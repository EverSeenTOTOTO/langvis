import { RedisKeys } from '@/shared/constants';
import type { SessionPhase } from '@/shared/types';
import type { SSEFrame } from '@/shared/types/events';
import type { RunSnapshot } from '@/shared/types/render';
import type { Message } from '@/shared/types/entities';
import type { Transport } from '@/shared/transport';
import { inject } from 'tsyringe';
import type { AgentRun } from '../agent/domain/agent-run.entity';
import { Conversation } from './domain/conversation.entity';
import { NoActiveRunError } from './domain/conversation.errors';
import { service } from '@/server/decorator/service';
import Logger from '@/server/utils/logger';
import { RedisService } from '@/server/libs/infrastructure/redis.service';
import { MESSAGE_REPOSITORY } from './conversation.di-tokens';
import type { MessageRepositoryPort } from './database/message.repository.port';
import { SessionConnection } from './application/session-connection';

type ActiveEntry = { message: Message; run: AgentRun };

/**
 * SessionManager — Process Manager.
 *
 * Coordinates between Conversation (domain aggregate),
 * AgentRun (agent domain), and SSE (infrastructure).
 * Owns the maps that were previously on Conversation.
 */
@service()
export class SessionManager {
  private readonly logger = Logger.child({ source: 'SessionManager' });
  private sessions = new Map<string, Conversation>();
  private connections = new Map<string, SessionConnection>();
  private activeRuns = new Map<string, Map<string, ActiveEntry>>();

  constructor(
    @inject(RedisService) private redisService: RedisService,
    @inject(MESSAGE_REPOSITORY)
    private messageRepo: MessageRepositoryPort,
  ) {}

  getSession(conversationId: string): Conversation | undefined {
    return this.sessions.get(conversationId);
  }

  async acquireSession(conversationId: string): Promise<Conversation | null> {
    const existing = this.sessions.get(conversationId);
    if (existing) {
      this.logger.info(`Session reconnected`, {
        sessionId: conversationId,
        phase: existing.phase,
      });
      return existing;
    }

    await this.cleanupStaleState(conversationId);

    this.logger.info(`Session created`, { sessionId: conversationId });

    const conversation = new Conversation(conversationId);

    this.sessions.set(conversationId, conversation);

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

    return conversation;
  }

  async dispose(): Promise<void> {
    const count = this.sessions.size;
    for (const [id, conversation] of this.sessions) {
      conversation.dispose();
      this.handleDomainEvents(conversation);
      this.connections.get(id)?.dispose();
    }
    this.logger.info(`Closed ${count} SSE sessions`);
  }

  // ════════════════════════════════════════
  // Transport management (moved from Conversation)
  // ════════════════════════════════════════

  attachTransport(
    conversationId: string,
    transport: Transport<SSEFrame>,
  ): void {
    let connection = this.connections.get(conversationId);
    if (!connection) {
      connection = new SessionConnection(conversationId, 30_000, () => {
        const conv = this.sessions.get(conversationId);
        if (conv) {
          conv.dispose();
          this.handleDomainEvents(conv);
        }
      });
      this.connections.set(conversationId, connection);
    }

    connection.attach(transport);

    // Replay buffered events from active runs
    const runs = this.activeRuns.get(conversationId);
    if (runs) {
      for (const [messageId, entry] of runs) {
        if (!entry.run.isTerminated) {
          for (const event of entry.run.bufferedEvents) {
            const frame = { ...event, messageId } as SSEFrame;
            transport.send(frame);
          }
          this.logger.info(
            `Replayed ${entry.run.bufferedEvents.length} events for message ${messageId}`,
            { sessionId: conversationId, messageId },
          );
        }
      }
    }

    this.logger.info(`Transport attached with event replay`, {
      sessionId: conversationId,
    });
  }

  sendFrame(conversationId: string, frame: SSEFrame): boolean {
    const connection = this.connections.get(conversationId);
    return connection?.send(frame) ?? false;
  }

  // ════════════════════════════════════════
  // AgentRun lifecycle (moved from Conversation)
  // ════════════════════════════════════════

  registerRun(conversationId: string, message: Message, run: AgentRun): void {
    const conversation = this.sessions.get(conversationId);
    if (!conversation) throw new Error('No session');

    conversation.startTurn(message.id);
    this.handleDomainEvents(conversation);

    if (!this.activeRuns.has(conversationId)) {
      this.activeRuns.set(conversationId, new Map());
    }
    this.activeRuns.get(conversationId)!.set(message.id, { message, run });
  }

  finalizeRun(
    conversationId: string,
    messageId: string,
  ): ActiveEntry | undefined {
    const runs = this.activeRuns.get(conversationId);
    const entry = runs?.get(messageId);
    if (!entry) return undefined;

    runs!.delete(messageId);
    if (runs!.size === 0) {
      this.activeRuns.delete(conversationId);
      this.connections.get(conversationId)?.markIdle();
    }

    const conversation = this.sessions.get(conversationId);
    if (conversation) {
      conversation.completeTurn(messageId);
      this.handleDomainEvents(conversation);
    }

    return entry;
  }

  cancelConversation(conversationId: string, reason: string): void {
    const conversation = this.sessions.get(conversationId);
    if (!conversation) return;

    conversation.requestCancellation(undefined, reason);
    this.handleDomainEvents(conversation);

    const runs = this.activeRuns.get(conversationId);
    if (runs) {
      for (const { run } of runs.values()) {
        if (!run.isTerminated) {
          try {
            run.cancel(reason);
          } catch {
            // Already terminated
          }
        }
      }
    }
  }

  cancelMessage(conversationId: string, messageId: string): void {
    const conversation = this.sessions.get(conversationId);
    if (!conversation) return;

    const runs = this.activeRuns.get(conversationId);
    const entry = runs?.get(messageId);
    if (!entry) throw new NoActiveRunError(messageId);

    conversation.requestCancellation(messageId, 'Cancelled by user');
    this.handleDomainEvents(conversation);

    if (!entry.run.isTerminated) {
      try {
        entry.run.cancel('Cancelled by user');
      } catch {
        // Already terminated
      }
    }
  }

  getRun(conversationId: string, messageId: string): AgentRun | undefined {
    return this.activeRuns.get(conversationId)?.get(messageId)?.run;
  }

  getActiveSnapshots(conversationId: string): RunSnapshot[] {
    const runs = this.activeRuns.get(conversationId);
    if (!runs) return [];
    return Array.from(runs.values()).map(({ run }) => run.toSnapshot());
  }

  // ════════════════════════════════════════
  // Redis session state
  // ════════════════════════════════════════

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

  async getSessionState(
    conversationId: string,
  ): Promise<ChatSessionState | null> {
    return this.redisService.get<ChatSessionState>(
      RedisKeys.CHAT_SESSION(conversationId),
    );
  }

  /**
   * 处理聚合根收集的领域事件。
   * 在每次 conversation 操作后调用。
   */
  handleDomainEvents(conversation: Conversation): void {
    for (const event of conversation.domainEvents) {
      switch (event.type) {
        case 'phase_changed': {
          const { to } = event.payload as {
            from: SessionPhase;
            to: SessionPhase;
          };
          this.updateSessionPhase(event.aggregateId, to);
          break;
        }
        case 'conversation_disposed': {
          this.sessions.delete(event.aggregateId);
          this.activeRuns.delete(event.aggregateId);
          this.connections.delete(event.aggregateId);
          this.redisService.del(RedisKeys.CHAT_SESSION(event.aggregateId));
          break;
        }
      }
    }
    conversation.clearEvents();
  }

  private async cleanupStaleState(conversationId: string): Promise<void> {
    const state = await this.getSessionState(conversationId);
    if (!state) return;

    if (state.phase !== 'done' && state.phase !== 'waiting') {
      this.logger.warn(`Stale session detected`, {
        sessionId: conversationId,
        phase: state.phase,
      });

      const staleMessages =
        await this.messageRepo.findActiveAssistantMessages(conversationId);

      if (staleMessages.length > 0) {
        await Promise.all(
          staleMessages.map(msg =>
            this.messageRepo.update(msg.id, {
              content:
                msg.content || 'Generation interrupted (server restarted)',
              status: 'failed',
            }),
          ),
        );
      }
    }

    await this.redisService.del(RedisKeys.CHAT_SESSION(conversationId));
  }
}

export interface ChatSessionState {
  conversationId: string;
  phase: SessionPhase;
  messages: Array<{ messageId: string; phase: string }>;
  startedAt: number;
  agentId: string | null;
}
