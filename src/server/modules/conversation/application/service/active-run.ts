import type { StreamFrame, EnrichedEvent } from '@/shared/types/events';
import {
  applyEventToView,
  emptyRunView,
  extractChildEvents,
  type RunView,
} from '@/server/modules/conversation/application/service/run-projection';

/** Coalesce window for run_view emission — bounds wire/render rate during rapid
 * streams (text_chunk / tool_progress). Terminal + awaiting-input transitions
 * bypass it and flush synchronously (see handleRunEvent). */
const RUN_VIEW_FLUSH_MS = 30;

/**
 * 活跃 run 的会话内追踪——自持事件缓冲 + 增量投影视图 + 合并 flush。
 * session 只登记/查找/转发事件，run 的投影与下发逻辑内聚于此。
 */
export class ActiveRun {
  private events: EnrichedEvent[] = [];
  private view: RunView = emptyRunView();
  private flushTimer?: ReturnType<typeof setTimeout>;

  constructor(
    readonly messageId: string,
    readonly runId: string,
    private readonly send: (frame: StreamFrame) => void,
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
