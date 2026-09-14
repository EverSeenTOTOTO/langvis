import type { StreamFrame, EnrichedEvent } from '@/shared/types/events';
import {
  applyEventToView,
  emptyRunView,
  extractChildEvents,
  type RunView,
} from '@/server/modules/conversation/application/service/run-projection';

const RUN_VIEW_FLUSH_MS = 30;

// 活跃 run 的会话内追踪——自持事件缓冲 + 增量投影视图 + 合并 flush。 session 只登记/查找/转发事件，run 的投影与下发逻辑内聚于此。
export class ActiveRun {
  private events: EnrichedEvent[] = [];
  private view: RunView = emptyRunView();
  private flushTimer?: ReturnType<typeof setTimeout>;
  // 增量帧游标：events[0..sentEventCount) 已随 run_events 下发。 flush 送达才前进——断线期间事件滞留，重连后首个 flush 补发。
  private sentEventCount = 0;

  constructor(
    readonly messageId: string,
    readonly runId: string,
    private readonly send: (frame: StreamFrame) => boolean,
  ) {}

  handleEvent(event: EnrichedEvent): void {
    // loop 用量是 per-run 遥测——翻译为控制帧直发，不入事件缓冲/投影（不污染 snapshot）。
    if (event.type === 'loop_usage') {
      this.send({
        type: 'loop_usage',
        runId: this.runId,
        used: event.used,
        total: event.total,
      });
      return;
    }
    this.events.push(event);
    applyEventToView(this.view, event);
    this.scheduleFlush();
  }

  getEvents(): readonly EnrichedEvent[] {
    return this.events;
  }

  /** 终态文案——live view 的 content，事件增量 fold 维护，turn 收尾直接取用。 */
  getFinalContent(): string {
    return this.view.content;
  }

  /** 子 run（call_subagents 的 child）事件——从 tool_progress 进度块按 childRunId 解包。 */
  extractChildEvents(childRunId: string): readonly EnrichedEvent[] {
    return extractChildEvents(this.events, childRunId);
  }

  /** 重连补发滞留增量（断线期间 send 失败滞留的 run_events），不碰视图帧与定时器。 */
  flushEvents(): void {
    this.flushPendingEvents();
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

  // Coalesce run_view emission: first event arms a timer, later ones keep folding into view.
  private scheduleFlush(): void {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, RUN_VIEW_FLUSH_MS);
  }

  /** Send pending events as run_events frame. Cursor advances only on delivery. */
  private flushPendingEvents(): void {
    if (this.sentEventCount >= this.events.length) return;
    const pending = this.events.slice(this.sentEventCount);
    const delivered = this.send({
      type: 'run_events',
      messageId: this.messageId,
      runId: this.runId,
      events: pending,
    });
    if (delivered) this.sentEventCount = this.events.length;
  }

  /** Send pending run_events then the run_view snapshot. Clears any pending timer. */
  flush(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    this.flushPendingEvents();
    this.send(this.buildFrame());
  }

  /** Clear pending timer without flushing（会话释放时）。 */
  dispose(): void {
    if (this.flushTimer) clearTimeout(this.flushTimer);
  }
}
