import type { StreamFrame, EnrichedEvent } from '@/shared/types/events';
import type { Transport } from '@/shared/transport';
import { inject, singleton } from 'tsyringe';
import {
  lifecycleHook,
  type LifecycleHook,
} from '@/server/decorator/lifecycle';
import { RedisService } from '@/server/libs/infrastructure/redis.service';
import { RedisKeys } from '@/shared/constants';
import { EventBus, createDomainEvent } from '@/server/libs/ddd';
import { CancelRun } from '@/server/modules/agent/contracts';
import { ChatService } from './chat.service';
import { ConversationSession } from './conversation-session';
import type { ConversationContext } from '../../domain/model/conv-transform';
import { getConvTransformPlan } from '../transforms';
import type { Message } from '@/shared/types/entities';
import Logger from '@/server/utils/logger';

@singleton()
@lifecycleHook
export class SessionManager implements LifecycleHook {
  private readonly logger = Logger.child({ source: 'SessionManager' });
  private readonly sessions = new Map<string, ConversationSession>();

  constructor(
    @inject(RedisService)
    private redisService: RedisService,
    @inject(ChatService)
    private convService: ChatService,
    @inject(EventBus)
    private eventBus: EventBus,
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
    this.redisService.del(RedisKeys.CHAT_SESSION(conversationId));
    this.logger.info(`Chat disposed`, { chatId: conversationId });
  }

  async onShutdown(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
    this.logger.info(`Closed all SSE connections`);
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
    await this.redisService.set(
      RedisKeys.CHAT_SESSION(conversationId),
      { conversationId, startedAt: Date.now() },
      3600,
    );
  }

  hasSession(conversationId: string): boolean {
    return this.sessions.get(conversationId)?.hasConnection ?? false;
  }

  sendFrame(conversationId: string, frame: StreamFrame): boolean {
    return this.sessions.get(conversationId)?.sendFrame(frame) ?? false;
  }

  /** RunStarted：登记活跃 run（创建事件缓冲）。须在首条 RunEvent 前同步完成。 */
  registerRun(conversationId: string, messageId: string, runId: string): void {
    this.getOrCreate(conversationId).registerRun(messageId, runId);
  }

  /** 取某活跃 run 的累积事件流（CompleteTurn 投影用）。 */
  getRunEvents(
    conversationId: string,
    messageId: string,
  ): readonly EnrichedEvent[] | undefined {
    return this.sessions.get(conversationId)?.getRunEvents(messageId);
  }

  /** 取某子 run（call_subagents 的 child）的事件流——扫描活跃 session 的父 run 缓冲，
   *  从父的 tool_progress { childRunId, event } 块中提取。未找到返回 undefined（调用方回落到 repo）。 */
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
    this.eventBus.dispatch(
      CancelRun,
      createDomainEvent(CancelRun, run.runId, {
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
    runtimeConfig: Record<string, unknown>,
  ): void {
    this.getOrCreate(conversationId).activateContext(
      messages,
      runtimeConfig,
      getConvTransformPlan(),
    );
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

  /**
   * 孤儿 run 对账（运行期取消用例）：扫描本会话 status 仍为 initialized/running、
   * 但本进程 activeRuns 已无对应记录的 run，统一在 DB 里驱动到终态。
   * 重启残留由 OrphanRunReconciler 在启动期清扫；此处只动 DB，不补发帧——前端经重连/重拉拿到终态。
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
  }
}

export interface ChatState {
  conversationId: string;
  startedAt: number;
}
