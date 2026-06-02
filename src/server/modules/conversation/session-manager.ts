import { RedisKeys } from '@/shared/constants';
import type { SessionPhase } from '@/shared/types';
import { inject } from 'tsyringe';
import { Conversation } from './domain/conversation.entity';
import { service } from '@/server/decorator/service';
import Logger from '@/server/utils/logger';
import { RedisService } from '@/server/libs/infrastructure/redis.service';
import { MESSAGE_REPOSITORY } from './conversation.di-tokens';
import type { MessageRepositoryPort } from './database/message.repository.port';

@service()
export class SessionManager {
  private readonly logger = Logger.child({ source: 'SessionManager' });
  private sessions = new Map<string, Conversation>();

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

    const conversation = new Conversation(conversationId, {
      idleTimeoutMs: 30_000,
    });

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
    for (const conversation of this.sessions.values()) {
      conversation.dispose();
      this.handleDomainEvents(conversation);
    }
    this.logger.info(`Closed ${count} SSE sessions`);
  }

  cancelConversation(conversationId: string, reason: string): void {
    const conversation = this.sessions.get(conversationId);
    if (!conversation) return;
    conversation.cancelAll(reason);
    this.handleDomainEvents(conversation);
  }

  cancelMessage(conversationId: string, messageId: string): void {
    const conversation = this.sessions.get(conversationId);
    if (!conversation) return;
    conversation.cancelMessage(messageId);
    this.handleDomainEvents(conversation);
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
