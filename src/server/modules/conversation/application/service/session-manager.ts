import type { SSEFrame } from '@/shared/types/events';
import type { EnrichedEvent } from '@/shared/types/events';
import type { Transport } from '@/shared/transport';
import { inject, singleton } from 'tsyringe';
import { RedisService } from '@/server/libs/infrastructure/redis.service';
import { RedisKeys } from '@/shared/constants';
import { Connection } from './connection';
import type { AgentRun } from '@/server/modules/agent/domain/model/agent-run.entity';
import { AgentRunExecutor } from '@/server/modules/agent/application/service/agent-run-executor';
import { projectRun } from '@/server/modules/agent/domain/projection/run-projection';
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
    @inject(AgentRunExecutor)
    private executor: AgentRunExecutor,
  ) {}

  // ════════════════════════════════════════
  // Session 生命周期
  // ════════════════════════════════════════

  async acquireChat(conversationId: string): Promise<void> {
    // 内存中已有活跃 connection —— 重连
    if (this.connections.has(conversationId)) {
      this.logger.info(`Chat reconnected`, { chatId: conversationId });
      return;
    }

    await this.cleanupStaleState(conversationId);

    await this.redisService.set(
      RedisKeys.CHAT_SESSION(conversationId),
      { conversationId, startedAt: Date.now(), agentId: null },
      3600,
    );
  }

  disposeChat(conversationId: string): void {
    const conn = this.connections.get(conversationId);
    if (conn) {
      conn.dispose();
      this.connections.delete(conversationId);
    }

    this.activeRuns.delete(conversationId);
    this.redisService.del(RedisKeys.CHAT_SESSION(conversationId));
    this.logger.info(`Chat disposed`, { chatId: conversationId });
  }

  async disposeAll(): Promise<void> {
    for (const conn of this.connections.values()) {
      conn.dispose();
    }
    this.connections.clear();
    this.activeRuns.clear();
    this.logger.info(`Closed all SSE connections`);
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

  hasSession(conversationId: string): boolean {
    return this.connections.has(conversationId);
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

    // replay: 从活跃 run 的事件流现算 snapshot
    for (const [messageId, run] of this.activeRuns.get(conversationId) ?? []) {
      const view = projectRun(run.eventStream);
      conn.send({
        type: 'state_snapshot',
        messageId,
        content: view.content,
        steps: view.steps,
        status: view.status,
        awaitingInput: view.awaitingInput,
      } as SSEFrame);
      this.logger.info(
        `Replayed snapshot: ${view.content.length} chars, ${view.steps.length} steps`,
        { chatId: conversationId, messageId },
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

  getActiveRun(
    conversationId: string,
    messageId: string,
  ): AgentRun | undefined {
    return this.activeRuns.get(conversationId)?.get(messageId);
  }

  hasActiveRun(conversationId: string, messageId: string): boolean {
    return this.activeRuns.get(conversationId)?.has(messageId) ?? false;
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
        // Headless run (no SSE connection) — dispose session immediately
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
      // executor.cancel: abort + 记录 cancelled 事件；返回富化事件直接推送 SSE
      const cancelled = this.executor.cancel(run, reason);
      if (cancelled) {
        this.processRunEvent(conversationId, messageId, cancelled);
      }
    }
  }

  cancelAllActiveRuns(conversationId: string, reason: string): void {
    const runs = this.activeRuns.get(conversationId);
    if (!runs) return;
    for (const messageId of runs.keys()) {
      this.cancelActiveRun(conversationId, messageId, reason);
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

  // ── 内部 ──

  /**
   * Stale 检测：基于 Redis session 记录的存在性 + agent_runs.status。
   * 正常 dispose 会删 Redis 记录 —— 残留记录意味着上次会话未清理（多为服务重启）。
   * 扫描 status 仍为 initialized/running 的 run，标记为 failed。
   */
  private async cleanupStaleState(conversationId: string): Promise<void> {
    const state = await this.getChatState(conversationId);
    if (!state) return;

    this.logger.warn(`Stale session detected`, { chatId: conversationId });

    const staleMessages =
      await this.convService.findActiveAssistantMessages(conversationId);

    if (staleMessages.length > 0) {
      await this.convService.markMessagesFailed(
        staleMessages,
        'Generation interrupted (server restarted)',
      );
    }

    await this.redisService.del(RedisKeys.CHAT_SESSION(conversationId));
  }
}

export interface ChatState {
  conversationId: string;
  startedAt: number;
  agentId: string | null;
}
