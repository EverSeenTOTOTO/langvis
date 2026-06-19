import type { SSEFrame } from '@/shared/types/events';
import type { EnrichedEvent } from '@/shared/types/events';
import type { ChatPhase } from '@/shared/types';
import type { Transport } from '@/shared/transport';
import { inject, singleton } from 'tsyringe';
import { RedisService } from '@/server/libs/infrastructure/redis.service';
import { RedisKeys } from '@/shared/constants';
import { Chat } from '../../domain/model/chat';
import { Connection } from './connection';
import type { AgentRun } from '@/server/modules/agent/domain/model/agent-run.entity';
import { ChatService } from './chat.service';
import Logger from '@/server/utils/logger';

@singleton()
export class SessionManager {
  private readonly logger = Logger.child({ source: 'SessionManager' });

  private connections = new Map<string, Connection>();
  private activeRuns = new Map<string, Map<string, AgentRun>>();

  constructor(
    @inject(RedisService)
    private redisService: RedisService,
    @inject(ChatService)
    private convService: ChatService,
  ) {}

  // ════════════════════════════════════════
  // Session 生命周期
  // ════════════════════════════════════════

  async acquireChat(conversationId: string): Promise<Chat> {
    const existing = this.convService.getChat(conversationId);
    if (existing) {
      this.logger.info(`Chat reconnected`, {
        chatId: conversationId,
        phase: existing.phase,
      });
      return existing;
    }

    await this.cleanupStaleState(conversationId);
    const chat = this.convService.getOrCreateChat(conversationId);

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

    return chat;
  }

  disposeChat(conversationId: string): void {
    const conn = this.connections.get(conversationId);
    if (conn) {
      conn.dispose();
      this.connections.delete(conversationId);
    }

    const chat = this.convService.getChat(conversationId);
    if (chat && !chat.isDisposed) {
      chat.dispose();
      this.syncInfrastructure(chat);
      chat.clearEvents();
    }

    this.activeRuns.delete(conversationId);
    this.logger.info(`Chat disposed`, { chatId: conversationId });
  }

  async disposeAll(): Promise<void> {
    for (const conn of this.connections.values()) {
      conn.dispose();
    }
    for (const [, chat] of this.convService.allChats()) {
      if (!chat.isDisposed) {
        chat.dispose();
        this.syncInfrastructure(chat);
        chat.clearEvents();
      }
    }
    this.logger.info(`Closed ${this.connections.size} SSE connections`);
  }

  /** 初始化会话：acquireChat + attachTransport + dispose 回调 */
  async initSession(
    conversationId: string,
    transport: Transport<SSEFrame>,
  ): Promise<void> {
    await this.acquireChat(conversationId);
    this.attachTransport(conversationId, transport, () =>
      this.disposeChat(conversationId),
    );
  }

  // ════════════════════════════════════════
  // SSE / Transport
  // ════════════════════════════════════════

  attachTransport(
    conversationId: string,
    transport: Transport<SSEFrame>,
    onIdle?: () => void,
  ): void {
    let conn = this.connections.get(conversationId);
    if (!conn) {
      conn = new Connection(conversationId, 30_000, () => {
        this.connections.delete(conversationId);
        onIdle?.();
      });
      this.connections.set(conversationId, conn);
    }
    conn.attach(transport);

    // replay: 从 PendingMessage snapshots 恢复所有 running turn
    const conv = this.convService.getChat(conversationId);
    for (const snapshot of conv?.getRunningSnapshots() ?? []) {
      conn.send({
        type: 'state_snapshot',
        messageId: snapshot.messageId,
        content: snapshot.content,
        steps: snapshot.steps,
      } as SSEFrame);
      this.logger.info(
        `Replayed snapshot: ${snapshot.content.length} chars, ${snapshot.steps.length} steps`,
        { chatId: conversationId, messageId: snapshot.messageId },
      );
    }

    this.logger.info(`Transport attached`, { chatId: conversationId });
  }

  sendFrame(conversationId: string, frame: SSEFrame): boolean {
    return this.connections.get(conversationId)?.send(frame) ?? false;
  }

  // ════════════════════════════════════════
  // Run 管理
  // ════════════════════════════════════════

  registerRun(conversationId: string, messageId: string, run: AgentRun): void {
    if (!this.activeRuns.has(conversationId)) {
      this.activeRuns.set(conversationId, new Map());
    }
    this.activeRuns.get(conversationId)!.set(messageId, run);
  }

  finalizeRun(conversationId: string, messageId: string): void {
    const runs = this.activeRuns.get(conversationId);
    if (!runs) return;
    runs.delete(messageId);
    if (runs.size === 0) {
      this.activeRuns.delete(conversationId);
      const conn = this.connections.get(conversationId);
      if (conn) {
        conn.markIdle();
      } else {
        // Headless run (no SSE connection) — dispose Chat immediately
        this.disposeChat(conversationId);
      }
    }
  }

  cancelActiveRun(
    conversationId: string,
    messageId: string,
    reason: string,
  ): void {
    const run = this.activeRuns.get(conversationId)?.get(messageId);
    if (run && !run.isTerminated) {
      try {
        run.cancel(reason);
      } catch {
        // Already terminated
      }
    }
  }

  // ════════════════════════════════════════
  // RunEvent → SSE 桥接
  // ════════════════════════════════════════

  processRunEvent(
    conversationId: string,
    messageId: string,
    event: EnrichedEvent,
  ): void {
    const chat = this.convService.getChat(conversationId);
    if (!chat) return;
    chat.handleRunEvent(messageId, event);
    const frame = { ...event, messageId } as SSEFrame;
    this.connections.get(conversationId)?.send(frame);
  }

  // ════════════════════════════════════════
  // Redis session state
  // ════════════════════════════════════════

  async getChatState(conversationId: string): Promise<ChatState | null> {
    return this.redisService.get<ChatState>(
      RedisKeys.CHAT_SESSION(conversationId),
    );
  }

  /** 处理 Chat 聚合根领域事件的 infra 侧反应（Redis 更新、map 清理） */
  syncInfrastructure(chat: Chat): void {
    for (const event of chat.domainEvents) {
      switch (event.type) {
        case 'phase_changed': {
          const { to } = event.payload as { from: ChatPhase; to: ChatPhase };
          this.updateChatPhase(event.aggregateId, to);
          break;
        }
        case 'conversation_disposed': {
          this.connections.delete(event.aggregateId);
          this.activeRuns.delete(event.aggregateId);
          this.redisService.del(RedisKeys.CHAT_SESSION(event.aggregateId));
          break;
        }
      }
    }
  }

  // ── 内部 ──

  private async updateChatPhase(
    conversationId: string,
    phase: ChatPhase,
    agentId?: string,
  ): Promise<void> {
    const state = await this.getChatState(conversationId);
    if (!state) return;
    await this.redisService.set(
      RedisKeys.CHAT_SESSION(conversationId),
      { ...state, phase, agentId: agentId ?? state.agentId },
      3600,
    );
  }

  private async cleanupStaleState(conversationId: string): Promise<void> {
    const state = await this.getChatState(conversationId);
    if (!state) return;

    if (Chat.isStalePhase(state.phase)) {
      this.logger.warn(`Stale session detected`, {
        chatId: conversationId,
        phase: state.phase,
      });

      const staleMessages =
        await this.convService.findActiveAssistantMessages(conversationId);

      if (staleMessages.length > 0) {
        await this.convService.markMessagesFailed(
          staleMessages.map(msg => msg.id),
          'Generation interrupted (server restarted)',
        );
      }
    }

    await this.redisService.del(RedisKeys.CHAT_SESSION(conversationId));
  }
}

export interface ChatState {
  conversationId: string;
  phase: ChatPhase;
  messages: Array<{ messageId: string; phase: string }>;
  startedAt: number;
  agentId: string | null;
}
