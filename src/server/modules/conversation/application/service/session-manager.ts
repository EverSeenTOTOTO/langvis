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

  /**
   * 初始化会话：attachTransport + 孤儿 run 对账 + Redis 登记。
   *
   * 对账刻意放在 attachTransport 之后——这样标记终态的同一时刻能把帧推给客户端
   * 驱动其收敛。服务重启后 activeRuns（内存）已丢失，snapshot replay 与 cancel
   * 都无法让客户端的 running 节点终止；若对账早于 attach，客户端会永久卡在 loading。
   */
  async initSession(
    conversationId: string,
    transport: Transport<SSEFrame>,
  ): Promise<void> {
    // attach 之前判定「新会话」：attach 后 connections 必然命中。
    const fresh = !this.connections.has(conversationId);

    this.attachTransport(conversationId, transport, () =>
      this.disposeChat(conversationId),
    );

    if (!fresh) {
      this.logger.info(`Chat reconnected`, { chatId: conversationId });
      return;
    }

    await this.reconcileOrphanedRuns(
      conversationId,
      'failed',
      'Generation interrupted (server restarted)',
    );
    await this.redisService.set(
      RedisKeys.CHAT_SESSION(conversationId),
      { conversationId, startedAt: Date.now(), agentId: null },
      3600,
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

  async cancelAllActiveRuns(
    conversationId: string,
    reason: string,
  ): Promise<void> {
    const runs = this.activeRuns.get(conversationId);
    if (runs) {
      for (const messageId of runs.keys()) {
        this.cancelActiveRun(conversationId, messageId, reason);
      }
    }

    // 重启后 activeRuns 可能为空，但 DB 里仍可能有孤儿 run（如 SSE 连不上、
    // 客户端只能靠 cancel 终止时）。同样驱动到 cancelled，否则取消会 no-op。
    await this.reconcileOrphanedRuns(conversationId, 'cancelled', reason);
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

  // ── 内部 ──

  /**
   * 孤儿 run 对账：扫描 status 仍为 initialized/running、但本进程 activeRuns 里
   * 已无对应记录的 run（典型成因：服务重启致内存 activeRuns 丢失），统一驱动到终态。
   *
   * 不再依赖 Redis session key 的存在性——重启后即便 key 已过期（>1h 才重连），
   * 只要 DB 里仍是非终态且无活跃 run，就视为孤儿。须在 transport attach 后调用，
   * 这样标记终态的同一时刻能把帧推给客户端驱动其收敛。
   */
  private async reconcileOrphanedRuns(
    conversationId: string,
    status: 'failed' | 'cancelled',
    reason: string,
  ): Promise<void> {
    const active =
      await this.convService.findActiveAssistantMessages(conversationId);
    // 排除本进程仍在运行的 run（断线重连/多标签下的活跃 run 不算孤儿）。
    const orphans = active.filter(
      m => !this.hasActiveRun(conversationId, m.id),
    );
    if (orphans.length === 0) return;

    this.logger.warn(`Reconciling orphaned runs`, {
      chatId: conversationId,
      count: orphans.length,
      status,
    });

    await this.convService.markMessagesTerminated(orphans, status, reason);

    // 重启后 activeRuns 已丢失，snapshot replay 与 cancel 都无法让客户端的
    // running 节点终止——这里显式补发终态帧。run 已死，seq/at 合成即可。
    for (const msg of orphans) {
      const event =
        status === 'cancelled'
          ? ({ type: 'cancelled', reason } as const)
          : ({ type: 'error', error: reason } as const);
      this.processRunEvent(conversationId, msg.id, {
        ...event,
        runId: msg.agentRunId!,
        seq: 0,
        at: Date.now(),
      });
    }
  }
}

export interface ChatState {
  conversationId: string;
  startedAt: number;
  agentId: string | null;
}
