import type { SSEFrame, EnrichedEvent } from '@/shared/types/events';
import type { Transport } from '@/shared/transport';
import { inject, singleton } from 'tsyringe';
import { RedisService } from '@/server/libs/infrastructure/redis.service';
import { RedisKeys } from '@/shared/constants';
import { EventBus, createDomainEvent } from '@/server/libs/ddd';
import { CancelRun } from '@/server/modules/conversation/contracts';
import { ChatService } from './chat.service';
import { ConversationSession } from './conversation-session';
import type {
  ConversationMemory,
  ConversationMemoryConfig,
} from '../../domain/model/conversation-memory';
import type { Message } from '@/shared/types/entities';
import Logger from '@/server/utils/logger';

/**
 * 会话 registry（@singleton）：以 conversationId 索引 ConversationSession，维护孤儿 run 对账（依赖 ChatService）。
 * 公开方法是 thin delegators，调用方不变。
 */
@singleton()
export class SessionManager {
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

  async disposeAll(): Promise<void> {
    for (const session of this.sessions.values()) {
      session.dispose();
    }
    this.sessions.clear();
    this.logger.info(`Closed all SSE connections`);
  }

  /**
   * 初始化会话：attachTransport + 孤儿 run 对账 + Redis 登记。
   * 对账刻意放在 attach 之后——服务重启后内存 activeRuns 已丢，snapshot replay 与 cancel 都无法让客户端的
   * running 节点终止；attach 先行可让标记终态的同一时刻把帧推给客户端驱动其收敛。
   */
  async initSession(
    conversationId: string,
    transport: Transport<SSEFrame>,
  ): Promise<void> {
    const session = this.getOrCreate(conversationId);
    // attach 之前判定「新会话」：attach 后 hasConnection 必然为真。
    const fresh = !session.hasConnection;

    session.attachTransport(transport);

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
      { conversationId, startedAt: Date.now() },
      3600,
    );
  }

  hasSession(conversationId: string): boolean {
    return this.sessions.get(conversationId)?.hasConnection ?? false;
  }

  sendFrame(conversationId: string, frame: SSEFrame): boolean {
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

  /** 会话激活：灌入消息 + 配置构造 ConversationMemory 投影。 */
  activateMemory(
    conversationId: string,
    messages: Message[],
    config: ConversationMemoryConfig,
  ): void {
    this.getOrCreate(conversationId).activateMemory(messages, config);
  }

  getMemory(conversationId: string): ConversationMemory {
    const session = this.sessions.get(conversationId);
    if (!session?.hasMemory()) {
      throw new Error(`ConversationMemory: ${conversationId} not activated`);
    }
    return session.getMemory();
  }

  /**
   * 孤儿 run 对账：扫描 status 仍为 initialized/running、但本进程 activeRuns 里
   * 已无对应记录的 run（典型成因：服务重启致内存 activeRuns 丢失），统一驱动到终态。
   * 不依赖 Redis session key 的存在性——重启后即便 key 已过期（>1h 才重连），只要 DB 里仍是非终态且无活跃 run，就视为孤儿。
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
    const session = this.sessions.get(conversationId);
    for (const msg of orphans) {
      const event =
        status === 'cancelled'
          ? ({ type: 'cancelled', reason } as const)
          : ({ type: 'error', error: reason } as const);
      session?.sendFrame({
        ...event,
        runId: msg.agentRunId!,
        seq: 0,
        at: Date.now(),
        messageId: msg.id,
      } as SSEFrame);
    }
  }
}

export interface ChatState {
  conversationId: string;
  startedAt: number;
}
