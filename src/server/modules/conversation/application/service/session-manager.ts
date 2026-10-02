import { CancelRun } from '@/server/modules/agent/contracts';
import type { StreamFrame, EnrichedEvent } from '@/shared/types/events';
import type { Transport } from '@/shared/transport';
import { EventBus } from '@nestjs/cqrs';
import { ChatService } from './chat.service';
import { ConversationSession } from './conversation-session';
import type { ConversationContext } from '../../domain/model/conv-transform';
import type { ConversationConfig } from '@/server/modules/conversation/domain/config';
import type { ConvTransformPlan } from '@/server/modules/conversation/domain/model/conv-transform';
import { CONV_TRANSFORM_PLAN } from '../transforms';
import { computeContextUsage } from '../transforms/usage-transform';
import type { Message } from '@/shared/types/entities';
import { ProviderService } from '@/server/infrastructure/provider.service';
import { Inject, OnApplicationShutdown } from '@nestjs/common';
import Logger from '@/server/utils/logger';
import { disposeConversationTasks } from '@/server/modules/agent/implementations/tools/Bash/background-registry';

export interface ChatState {
  conversationId: string;
  startedAt: number;
}

export class SessionManager implements OnApplicationShutdown {
  private readonly logger = Logger.child({ source: 'SessionManager' });
  private readonly sessions = new Map<string, ConversationSession>();
  private readonly startedAt = new Map<string, number>();
  /** 关停 abort 后等终态落库的宽限；测试可覆盖调小。 */
  abortGraceMs = 3000;

  constructor(
    @Inject(ChatService)
    private convService: ChatService,
    @Inject(EventBus)
    private eventBus: EventBus,
    @Inject(ProviderService)
    private providerService: ProviderService,
    @Inject(CONV_TRANSFORM_PLAN)
    private readonly transformPlan: ConvTransformPlan,
  ) {}

  private getOrCreate(conversationId: string): ConversationSession {
    let session = this.sessions.get(conversationId);
    if (!session) {
      session = new ConversationSession(conversationId, 30_000, () =>
        this.disposeChat(conversationId),
      );
      this.sessions.set(conversationId, session);
    }
    return session;
  }

  disposeChat(conversationId: string): void {
    const session = this.sessions.get(conversationId);
    if (session) {
      this.sessions.delete(conversationId);
      session.dispose(); // 连接 idle 自释放路径下 connection 已 undefined，此处 no-op
    }
    this.startingTurns.delete(conversationId);
    disposeConversationTasks(conversationId); // 后台 bash 任务随会话清理，不留孤儿进程
    this.startedAt.delete(conversationId);
    this.logger.debug(`Chat disposed`, { chatId: conversationId });
  }

  async onApplicationShutdown(): Promise<void> {
    await this.abortActiveRuns('server shutting down');

    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
    this.logger.info(`Closed all SSE connections`);
  }

  // 关停先 abort 活跃 run 再让池销毁（LIFO 保证此刻池仍活）。
  // 派发 CancelRun 即时停 LLM；轮询 hasActiveRun 等终态落库，超时交 reconciler。
  private async abortActiveRuns(reason: string): Promise<void> {
    const snapshot: Array<[string, string]> = [];
    for (const [conversationId, session] of this.sessions) {
      for (const messageId of session.runMessageIds()) {
        snapshot.push([conversationId, messageId]);
      }
    }
    if (snapshot.length === 0) return;

    this.logger.info(`Aborting ${snapshot.length} active run(s) on shutdown`);
    for (const [conversationId, messageId] of snapshot) {
      this.cancelActiveRun(conversationId, messageId, reason);
    }

    const deadline = Date.now() + this.abortGraceMs;
    await new Promise<void>(resolve => {
      const tick = () => {
        const pending = snapshot.filter(([c, m]) => this.hasActiveRun(c, m));
        if (pending.length === 0 || Date.now() >= deadline) {
          if (pending.length > 0) {
            this.logger.warn(
              `${pending.length} run(s) still active after abort grace — leaving to reconciler`,
            );
          }
          resolve();
          return;
        }
        setTimeout(tick, 50);
      };
      tick();
    });
  }

  async initSession(
    conversationId: string,
    transport: Transport<StreamFrame>,
  ): Promise<void> {
    const session = this.getOrCreate(conversationId);
    // attach 之前判定「新会话」：attach 后 hasConnection 必然为真。
    const fresh = !session.hasConnection;

    session.attachTransport(transport);

    if (!fresh) {
      this.logger.info(`Chat reconnected`, { chatId: conversationId });
      return;
    }

    // 重启残留 run 的清扫已在启动期由 OrphanRunReconciler 完成，此处不再对账。
    this.startedAt.set(conversationId, Date.now());
  }

  /** 会话存活查询（HITL 提交后前端用于判断会话是否仍在）。 */
  getSessionState(conversationId: string): ChatState | null {
    const startedAt = this.startedAt.get(conversationId);
    return startedAt ? { conversationId, startedAt } : null;
  }

  hasSession(conversationId: string): boolean {
    return this.sessions.get(conversationId)?.hasConnection ?? false;
  }

  sendFrame(conversationId: string, frame: StreamFrame): boolean {
    return this.sessions.get(conversationId)?.sendFrame(frame) ?? false;
  }

  /** steering：该会话是否有活跃 run（决定新消息排队还是直发；含已持久化未登记的发起中 turn）。 */
  hasActiveRuns(conversationId: string): boolean {
    const session = this.sessions.get(conversationId);
    return (
      (!!session && !session.hasNoRuns) ||
      (this.startingTurns.get(conversationId)?.size ?? 0) > 0
    );
  }

  // ─── 会话级互斥与 turn 发起登记：check-then-act 竞态的内存侧互斥 ───
  // turn 发起/出队与 rewind 截断共用，串行化「hasActiveRuns 判定 → 持久化」窗口。非重入，禁止嵌套获取。
  private readonly conversationLocks = new Map<string, Promise<void>>();

  async withConversationLock<T>(
    conversationId: string,
    fn: () => Promise<T>,
  ): Promise<T> {
    const prev =
      this.conversationLocks.get(conversationId) ?? Promise.resolve();
    let release!: () => void;
    const gate = new Promise<void>(resolve => (release = resolve));
    this.conversationLocks.set(conversationId, gate);
    try {
      await prev;
      return await fn();
    } finally {
      release();
      if (this.conversationLocks.get(conversationId) === gate) {
        this.conversationLocks.delete(conversationId);
      }
    }
  }

  /** 已持久化、RunStarted 登记前的 turn——窗口期内 rewind/并发发起可见。 */
  private readonly startingTurns = new Map<string, Set<string>>();

  markTurnStarting(conversationId: string, messageId: string): void {
    const set = this.startingTurns.get(conversationId) ?? new Set<string>();
    set.add(messageId);
    this.startingTurns.set(conversationId, set);
  }

  unmarkTurnStarting(conversationId: string, messageId: string): void {
    this.startingTurns.get(conversationId)?.delete(messageId);
  }

  enqueueTurn(conversationId: string, assistantMessageId: string): void {
    this.sessions.get(conversationId)?.enqueueTurn(assistantMessageId);
  }

  /** 出队一个排队 turn（无则 undefined）。 */
  dequeueTurn(conversationId: string): string | undefined {
    return this.sessions.get(conversationId)?.dequeueTurn();
  }

  /** RunStarted：登记活跃 run（创建事件缓冲）。须在首条 RunEvent 前同步完成。 */
  registerRun(conversationId: string, messageId: string, runId: string): void {
    this.startingTurns.get(conversationId)?.delete(messageId);
    this.getOrCreate(conversationId).registerRun(messageId, runId);
  }

  /** 取某活跃 run 的累积事件流（CompleteTurn 投影用）。 */
  getRunEvents(
    conversationId: string,
    messageId: string,
  ): readonly EnrichedEvent[] | undefined {
    return this.sessions.get(conversationId)?.getRunEvents(messageId);
  }

  /** 取某活跃 run 的 live 投影文案（turn 收尾持久化用，免重 fold）。 */
  getFinalContent(
    conversationId: string,
    messageId: string,
  ): string | undefined {
    return this.sessions.get(conversationId)?.getFinalContent(messageId);
  }

  // 取子 run 事件流：扫描活跃 session 父 run 缓冲，从 tool_progress { childRunId, event } 中提取。
  getChildRunEvents(childRunId: string): readonly EnrichedEvent[] | undefined {
    for (const session of this.sessions.values()) {
      const child = session.getChildRunEvents(childRunId);
      if (child) return child;
    }
    return undefined;
  }

  handleRunEvent(
    conversationId: string,
    messageId: string,
    event: EnrichedEvent,
  ): void {
    this.sessions.get(conversationId)?.handleRunEvent(messageId, event);
  }

  hasActiveRun(conversationId: string, messageId: string): boolean {
    return this.sessions.get(conversationId)?.hasActiveRun(messageId) ?? false;
  }

  finalizeRun(conversationId: string, messageId: string): void {
    // 兜底：run 从未登记（启动即失败）时清掉发起中标记，防 hasActiveRuns 卡死
    this.startingTurns.get(conversationId)?.delete(messageId);
    const session = this.sessions.get(conversationId);
    if (!session) return;
    session.removeRun(messageId);
    if (session.hasNoRuns) {
      if (session.hasConnection) {
        session.markIdle();
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
    const run = this.sessions.get(conversationId)?.getRun(messageId);
    if (!run) return;
    // 事件驱动取消：会话不再直接调 agent 的 executor；agent 取消后 cancelled 事件经 RunEvent 回流。
    this.eventBus.publish(
      new CancelRun(run.runId, {
        runId: run.runId,
        conversationId,
        messageId,
        reason,
      }),
    );
  }

  async cancelAllActiveRuns(
    conversationId: string,
    reason: string,
  ): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (session) {
      for (const messageId of session.runMessageIds()) {
        this.cancelActiveRun(conversationId, messageId, reason);
      }
    }

    // 重启后 activeRuns 可能为空，但 DB 里仍可能有孤儿 run（如 SSE 连不上、
    // 客户端只能靠 cancel 终止时）。同样驱动到 cancelled，否则取消会 no-op。
    await this.reconcileOrphanedRuns(conversationId, 'cancelled', reason);
  }

  /** 会话上下文激活：messages 上 session + 解析 transform 管道（全局单例，跨会话不变）。 */
  activateContext(
    conversationId: string,
    messages: Message[],
    runtimeConfig: ConversationConfig,
  ): void {
    this.getOrCreate(conversationId).activateContext(
      messages,
      runtimeConfig,
      this.transformPlan,
    );
  }

  /** 配置变更后刷新已激活会话的 runtimeConfig 缓存；未激活会话 no-op。 */
  refreshRuntimeConfig(
    conversationId: string,
    runtimeConfig: ConversationConfig,
  ): void {
    const session = this.sessions.get(conversationId);
    if (!session) return;
    session.updateRuntimeConfig(runtimeConfig);
    // 配置更新不算相位、不触发 UsageTransform；模型切换时立即重推用量，客户端 usage 栏即时刷新。
    if (!session.hasCtx() || !session.hasConnection) return;
    const ctx = session.getCtx();
    const total = this.providerService.resolveContextSize(runtimeConfig);
    const { used } = computeContextUsage(ctx.messages, total);
    session.sendFrame({ type: 'conversation_usage', used, total });
  }

  hasCtx(conversationId: string): boolean {
    return this.sessions.get(conversationId)?.hasCtx() ?? false;
  }

  getCtx(conversationId: string): ConversationContext {
    const session = this.sessions.get(conversationId);
    if (!session?.hasCtx()) {
      throw new Error(`ConversationContext: ${conversationId} not activated`);
    }
    return session.getCtx();
  }

  flushRunView(conversationId: string, messageId: string): void {
    this.sessions.get(conversationId)?.flushRunView(messageId);
  }

  beginMaintenance(conversationId: string): void {
    this.sessions.get(conversationId)?.beginMaintenance();
  }

  endMaintenance(conversationId: string): void {
    this.sessions.get(conversationId)?.endMaintenance();
  }

  awaitMaintenance(conversationId: string): Promise<void> {
    return (
      this.sessions.get(conversationId)?.awaitMaintenance() ?? Promise.resolve()
    );
  }

  // 孤儿 run 对账：扫描已无活跃记录的 run，统一在 DB 驱动到终态（重启残留由 OrphanRunReconciler 清扫）。
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
  }
}
