import type { StreamFrame, EnrichedEvent } from '@/shared/types/events';
import type { Transport } from '@/shared/transport';
import { Connection } from './connection';
import {
  applyEventToView,
  emptyRunView,
  extractChildEvents,
  type RunView,
} from '@/server/modules/conversation/application/service/run-projection';
import type { Message } from '@/shared/types/entities';
import Logger from '@/server/utils/logger';
import { ListMonad } from '@/server/libs/list';
import type { ConversationConfig } from '@/server/libs/config';
import {
  ConvTransformPlan,
  type ConversationContext,
} from '../../domain/model/conv-transform';

/** Coalesce window for run_view emission — bounds wire/render rate during rapid
 * streams (text_chunk / tool_progress). Terminal + awaiting-input transitions
 * bypass it and flush synchronously (see handleRunEvent). */
const RUN_VIEW_FLUSH_MS = 30;

const logger = Logger.child({ source: 'ConversationSession' });

/**
 * 活跃 run 的会话内追踪——自持事件缓冲 + 增量投影视图 + 合并 flush。
 * session 只登记/查找/转发事件，run 的投影与下发逻辑内聚于此。
 */
class ActiveRun {
  private events: EnrichedEvent[] = [];
  private view: RunView = emptyRunView();
  private flushTimer?: ReturnType<typeof setTimeout>;

  constructor(
    readonly messageId: string,
    readonly runId: string,
    private readonly send: (frame: StreamFrame) => void,
  ) {}

  handleEvent(event: EnrichedEvent): void {
    this.events.push(event);
    applyEventToView(this.view, event);
    this.scheduleFlush();
  }

  getEvents(): readonly EnrichedEvent[] {
    return this.events;
  }

  /** 子 run（call_subagents 的 child）事件——从 tool_progress 进度块按 childRunId 解包。 */
  extractChildEvents(childRunId: string): readonly EnrichedEvent[] {
    return extractChildEvents(this.events, childRunId);
  }

  /** 当前视图的 run_view 帧（重连补发用，不碰合并定时器）。 */
  buildFrame(): StreamFrame {
    return {
      type: 'run_view',
      messageId: this.messageId,
      runId: this.runId,
      content: this.view.content,
      steps: this.view.steps,
      status: this.view.status,
      awaitingInput: this.view.awaitingInput,
      audio: this.view.audio,
      hooks: this.view.hooks,
    };
  }

  /** Coalesce run_view emission — first event in a quiet window arms a timer,
   * subsequent ones keep folding into view; the timer flushes the latest. */
  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, RUN_VIEW_FLUSH_MS);
  }

  /** Send current view as run_view frame. Clears any pending timer. */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.send(this.buildFrame());
  }

  /** Clear pending timer without flushing（会话释放时）。 */
  dispose(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
  }
}

export class ConversationSession {
  private connection: Connection | undefined;
  private readonly activeRuns = new Map<string, ActiveRun>();
  private messages: ListMonad<Message> | undefined;
  private runtimeConfig: ConversationConfig | undefined;
  private transforms: ConvTransformPlan | undefined;
  private maintenance:
    | { promise: Promise<void>; resolve: () => void }
    | undefined;

  constructor(
    readonly conversationId: string,
    private readonly idleTimeout: number,
    private readonly onConnectionLost: () => void,
  ) {}

  get hasConnection(): boolean {
    return this.connection !== undefined;
  }

  /**
   * attach 传输（多标签可重复 attach）。首次 attach 建 Connection；
   * attach 后对缓冲的活跃 run 补发 run_view（重连同一进程的活跃 run）。
   */
  attachTransport(transport: Transport<StreamFrame>): void {
    if (!this.connection) {
      this.connection = new Connection(
        this.conversationId,
        this.idleTimeout,
        () => {
          // 连接自释放：先摘引用，再回调 registry（registry 的 disposeChat 会再 dispose 本对象，
          // 但 connection 已 undefined → session.dispose 内 connection?.dispose() 为 no-op，无重入循环）。
          this.connection = undefined;
          this.onConnectionLost();
        },
        // 有活跃 run 或在飞维护时拒绝 idle 释放——避免清掉事件缓冲/上下文/压缩导致孤儿化。
        () => this.activeRuns.size === 0 && !this.maintenance,
      );
    }
    this.connection.attach(transport);

    for (const run of this.activeRuns.values()) {
      this.connection.send(run.buildFrame());
      logger.info(`Replayed run_view (run ${run.runId})`, {
        chatId: this.conversationId,
        messageId: run.messageId,
      });
    }

    // 会话用量基线由 activated-phase 的 usage transform 下发（激活先于 attach），此处不再内联发送。
    logger.info(`Transport attached`, { chatId: this.conversationId });
  }

  sendFrame(frame: StreamFrame): boolean {
    return this.connection?.send(frame) ?? false;
  }

  markIdle(): void {
    this.connection?.markIdle();
  }

  registerRun(messageId: string, runId: string): void {
    this.activeRuns.set(
      messageId,
      new ActiveRun(messageId, runId, f => this.sendFrame(f)),
    );
  }

  hasActiveRun(messageId: string): boolean {
    return this.activeRuns.has(messageId);
  }

  getRunEvents(messageId: string): readonly EnrichedEvent[] | undefined {
    return this.activeRuns.get(messageId)?.getEvents();
  }

  /** 子 run 事件——扫描活跃 run 缓冲；仅父 run 仍在 session 内时可查，历史回落 repo。 */
  getChildRunEvents(childRunId: string): readonly EnrichedEvent[] | undefined {
    for (const run of this.activeRuns.values()) {
      const child = run.extractChildEvents(childRunId);
      if (child.length > 0) return child;
    }
    return undefined;
  }

  getRun(messageId: string): ActiveRun | undefined {
    return this.activeRuns.get(messageId);
  }

  runMessageIds(): string[] {
    return [...this.activeRuns.keys()];
  }

  get hasNoRuns(): boolean {
    return this.activeRuns.size === 0;
  }

  handleRunEvent(messageId: string, event: EnrichedEvent): void {
    // loop 用量是 per-run 遥测事实——翻译为控制帧下发，不入 run 事件缓冲（不污染 snapshot/投影）。
    if (event.type === 'loop_usage') {
      this.sendFrame({
        type: 'loop_usage',
        runId: event.runId,
        used: event.used,
        total: event.total,
      });
      return;
    }
    this.activeRuns.get(messageId)?.handleEvent(event);
  }

  /** Send the run's current view as a run_view frame（终态 flush 由 removeRun 负责）。 */
  flushRunView(messageId: string): void {
    this.activeRuns.get(messageId)?.flush();
  }

  /** 移除 run：drain 下发最终视图，再摘除。这是「保证终态送达」的唯一正确性 flush。 */
  removeRun(messageId: string): void {
    this.activeRuns.get(messageId)?.flush();
    this.activeRuns.delete(messageId);
  }

  /** 激活会话上下文：messages 上 session，灌入解析后的 runtimeConfig + transform 管道（由调用方解析传入——session 不碰容器）。 */
  activateContext(
    messages: Message[],
    runtimeConfig: ConversationConfig,
    transforms: ConvTransformPlan,
  ): void {
    this.messages = ListMonad.of(messages);
    this.runtimeConfig = runtimeConfig;
    this.transforms = transforms;
  }

  hasCtx(): boolean {
    return this.runtimeConfig !== undefined;
  }

  /** session 即 ctx：返回 this 经窄接口 ConversationContext（转换只够到 messages/runtimeConfig/transforms）。 */
  getCtx(): ConversationContext {
    if (!this.runtimeConfig || !this.messages || !this.transforms) {
      throw new Error(
        `ConversationContext: ${this.conversationId} not activated (activateContext missing)`,
      );
    }
    return this as unknown as ConversationContext;
  }

  /** turn-end 维护屏障：begin 在终态帧前、end 在维护完成后；
   *  awaitMaintenance 供 turn-start 等待在飞维护（永不 reject）。 */
  beginMaintenance(): void {
    let resolve!: () => void;
    const promise = new Promise<void>(r => {
      resolve = r;
    });
    this.maintenance = { promise, resolve };
  }

  endMaintenance(): void {
    this.maintenance?.resolve();
    this.maintenance = undefined;
  }

  awaitMaintenance(): Promise<void> {
    return (this.maintenance?.promise ?? Promise.resolve()).catch(() => {});
  }

  dispose(): void {
    this.endMaintenance();
    for (const run of this.activeRuns.values()) run.dispose();
    this.connection?.dispose();
    this.connection = undefined;
    this.activeRuns.clear();
    this.messages = undefined;
    this.runtimeConfig = undefined;
    this.transforms = undefined;
  }
}
