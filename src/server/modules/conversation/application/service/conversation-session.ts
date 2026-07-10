import type { StreamFrame, EnrichedEvent } from '@/shared/types/events';
import type { Transport } from '@/shared/transport';
import { Connection } from './connection';
import {
  applyEventToView,
  emptyRunView,
  extractChildEvents,
  type RunView,
} from '@/server/modules/conversation/application/service/run-projection';
import {
  ConversationMemory,
  type ConversationMemoryConfig,
} from '../../domain/model/conversation-memory';
import type { Message } from '@/shared/types/entities';
import Logger from '@/server/utils/logger';

/** 活跃 run 的会话内追踪——持 runId + 事件缓冲 + 增量投影视图。 */
interface ActiveRun {
  runId: string;
  events: EnrichedEvent[];
  view: RunView;
  /** Coalesced flush timer — one per run, fans out to all tabs via Connection. */
  flushTimer?: ReturnType<typeof setTimeout>;
}

/** Coalesce window for run_view emission — bounds wire/render rate during rapid
 * streams (text_chunk / tool_progress). Terminal + awaiting-input transitions
 * bypass it and flush synchronously (see handleRunEvent). */
const RUN_VIEW_FLUSH_MS = 30;

const logger = Logger.child({ source: 'ConversationSession' });

export class ConversationSession {
  private connection: Connection | undefined;
  private readonly activeRuns = new Map<string, ActiveRun>();
  private memory: ConversationMemory | undefined;

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
        // 有活跃 run 时拒绝 idle 释放——避免在 run 执行中清掉事件缓冲/记忆导致 run 孤儿化。
        () => this.activeRuns.size === 0,
      );
    }
    this.connection.attach(transport);

    for (const [messageId, run] of this.activeRuns) {
      this.connection.send(this.buildRunViewFrame(messageId, run));
      logger.info(
        `Replayed view: ${run.view.content.length} chars, ${run.view.steps.length} steps`,
        { chatId: this.conversationId, messageId },
      );
    }

    // 会话用量基线：连接就绪后下发当前 conversation_usage（memory 已在 activate 先行灌入）。
    // 未激活则跳过——complete-turn 会在首个 turn 后补发。
    if (this.memory) {
      const { used, total } = this.memory.getContextUsage();
      this.connection.send({
        type: 'conversation_usage',
        used,
        total,
      } as StreamFrame);
    }

    logger.info(`Transport attached`, { chatId: this.conversationId });
  }

  sendFrame(frame: StreamFrame): boolean {
    return this.connection?.send(frame) ?? false;
  }

  markIdle(): void {
    this.connection?.markIdle();
  }

  registerRun(messageId: string, runId: string): void {
    this.activeRuns.set(messageId, {
      runId,
      events: [],
      view: emptyRunView(),
    });
  }

  hasActiveRun(messageId: string): boolean {
    return this.activeRuns.has(messageId);
  }

  getRunEvents(messageId: string): readonly EnrichedEvent[] | undefined {
    return this.activeRuns.get(messageId)?.events;
  }

  /** 子 run（call_subagents 的 child）事件——从活跃父 run 的 tool_progress 进度块提取。
   *  仅父 run 仍在 session 缓冲内时可查；历史回落到 get-run-view 的 repo 路径。 */
  getChildRunEvents(childRunId: string): readonly EnrichedEvent[] | undefined {
    for (const run of this.activeRuns.values()) {
      const child = extractChildEvents(run.events, childRunId);
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
    const run = this.activeRuns.get(messageId);
    if (!run) return;

    // 缓冲原始事件——CompleteTurn 仍按事件流 projectRun 持久化 content/meta。
    run.events.push(event);
    applyEventToView(run.view, event);
    // 投影帧一律走合并窗口（吞吐优化）。终态的「保证最后一帧送达」由 removeRun 的
    // drain 负责——绑定 run 生命周期，而非在热路径里按事件类型特判。
    this.scheduleRunViewFlush(messageId);
  }

  /** Coalesce run_view emission — first event in a quiet window arms a timer,
   * subsequent ones just keep folding into run.view; the timer flushes the latest. */
  private scheduleRunViewFlush(messageId: string): void {
    const run = this.activeRuns.get(messageId);
    if (!run || run.flushTimer) return;
    run.flushTimer = setTimeout(() => {
      const r = this.activeRuns.get(messageId);
      if (r) r.flushTimer = undefined;
      this.flushRunView(messageId);
    }, RUN_VIEW_FLUSH_MS);
  }

  /** Send the current run.view as a run_view frame. No-op if the run was removed
   * (a coalesced timer may fire after removeRun). Clears any pending timer. */
  private flushRunView(messageId: string): void {
    const run = this.activeRuns.get(messageId);
    if (!run) return;
    if (run.flushTimer) {
      clearTimeout(run.flushTimer);
      run.flushTimer = undefined;
    }
    this.sendFrame(this.buildRunViewFrame(messageId, run));
  }

  private buildRunViewFrame(messageId: string, run: ActiveRun): StreamFrame {
    return {
      type: 'run_view',
      messageId,
      runId: run.runId,
      content: run.view.content,
      steps: run.view.steps,
      status: run.view.status,
      awaitingInput: run.view.awaitingInput,
      audio: run.view.audio,
      hooks: run.view.hooks,
    };
  }

  /** 移除 run（从 activeRuns 摘除）。Drain：摘除前同步下发最终视图——这是「保证终态
   *  送达」的唯一正确性 flush，绑定 run 生命周期，而非热路径里的事件类型特判。 */
  removeRun(messageId: string): void {
    this.flushRunView(messageId);
    this.activeRuns.delete(messageId);
  }

  /** 激活：灌入当前消息 + 配置构造会话记忆投影。 */
  activateMemory(messages: Message[], config: ConversationMemoryConfig): void {
    this.memory = new ConversationMemory({
      history: messages,
      contextSize: config.contextSize,
      runtimeConfig: config.runtimeConfig,
    });
  }

  hasMemory(): boolean {
    return !!this.memory;
  }

  getMemory(): ConversationMemory {
    if (!this.memory) {
      throw new Error(
        `ConversationMemory: ${this.conversationId} not activated (activateMemory missing)`,
      );
    }
    return this.memory;
  }

  dispose(): void {
    for (const run of this.activeRuns.values()) {
      if (run.flushTimer) clearTimeout(run.flushTimer);
    }
    this.connection?.dispose();
    this.connection = undefined;
    this.activeRuns.clear();
    this.memory = undefined;
  }
}
