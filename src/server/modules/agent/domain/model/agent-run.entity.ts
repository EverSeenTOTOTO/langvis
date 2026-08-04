import { RunConfigVO } from './run-config.vo';
import type { EnrichedEvent, RunEvent } from '@/shared/types/events';
import { RunAlreadyCompletedError } from '../errors';
import { AggregateRoot } from '@/server/libs/ddd';
import type { RunStatus } from '@/shared/types/agent';

export class AgentRun extends AggregateRoot<string> {
  readonly config: RunConfigVO;

  private status: RunStatus = 'initialized';
  private events: EnrichedEvent[] = [];
  #terminated = false;
  private readonly abortController = new AbortController();

  // HITL 待输入状态——运行期协调态（同 abortController，不入事件流）。
  // AskUser 经 ctx.run 登记并阻塞等待；web 经 executor.getActiveRun 提交。
  private awaitingInput: { formSchema: unknown; message: string } | null = null;
  private inputSubmitted = false;
  private inputResult?: Record<string, unknown>;
  private inputWaiter?: () => void;

  get runId(): string {
    return this.id;
  }
  get currentStatus(): RunStatus {
    return this.status;
  }
  get isTerminated(): boolean {
    return this.#terminated;
  }
  get eventStream(): readonly EnrichedEvent[] {
    return this.events;
  }
  /** 取消句柄——agent/tool 经 AgentRunContext.signal 读取 */
  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  constructor(runId: string, config: RunConfigVO) {
    super(runId);
    this.config = config;
  }

  // 唯一带终止守卫的入口。已终止则返回 null——静默丢弃而非抛异常，以兼容外部 cancel 与执行循环的竞态。
  append(event: RunEvent): EnrichedEvent | null {
    if (this.#terminated) return null;
    return this.record(event);
  }

  start(): EnrichedEvent {
    this.status = 'running';
    return this.record({ type: 'start' });
  }

  complete(): EnrichedEvent {
    if (this.#terminated) throw new RunAlreadyCompletedError(this.id);
    this.#terminated = true;
    this.status = 'completed';
    return this.record({ type: 'final' });
  }

  fail(error: string): EnrichedEvent {
    if (this.#terminated) throw new RunAlreadyCompletedError(this.id);
    this.#terminated = true;
    this.status = 'failed';
    return this.record({ type: 'error', error });
  }

  cancel(reason: string): EnrichedEvent | null {
    if (this.#terminated) return null;
    this.abortController.abort(reason);
    this.#terminated = true;
    this.status = 'cancelled';
    return this.record({ type: 'cancelled', reason });
  }

  /** AskUser：登记待输入表单（清空上次提交状态）。 */
  beginAwaitInput(payload: { formSchema: unknown; message: string }): void {
    this.awaitingInput = payload;
    this.inputSubmitted = false;
  }

  /** AskUser：阻塞等待提交。提交成功立即 resolve（附结果）；超时或中止 resolve false。 */
  waitForInput(
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<{ submitted: boolean; result?: Record<string, unknown> }> {
    if (!this.awaitingInput) return Promise.resolve({ submitted: false });
    if (this.inputSubmitted) {
      return Promise.resolve({ submitted: true, result: this.inputResult });
    }
    return new Promise(resolve => {
      const finish = (submitted: boolean, result?: Record<string, unknown>) => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
        this.inputWaiter = undefined;
        resolve({ submitted, result });
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      const onAbort = () => finish(false);
      signal.addEventListener('abort', onAbort, { once: true });
      if (signal.aborted) onAbort();
      this.inputWaiter = () => finish(true, this.inputResult);
    });
  }

  /** web（经 executor.getActiveRun）：提交结果。 */
  submitInput(
    data: Record<string, unknown>,
  ): 'not_found' | 'already_submitted' | 'success' {
    if (!this.awaitingInput) return 'not_found';
    if (this.inputSubmitted) return 'already_submitted';
    this.inputSubmitted = true;
    this.inputResult = data;
    this.inputWaiter?.();
    this.inputWaiter = undefined;
    return 'success';
  }

  /** web：HITL 等待状态查询（真刷新渲染 / 防重复提交用）。 */
  inputStatus(): {
    exists: boolean;
    submitted: boolean;
    message: string;
    schema: unknown;
  } | null {
    if (!this.awaitingInput) return null;
    return {
      exists: true,
      submitted: this.inputSubmitted,
      message: this.awaitingInput.message,
      schema: this.awaitingInput.formSchema,
    };
  }

  private record(event: RunEvent): EnrichedEvent {
    const enriched: EnrichedEvent = {
      ...event,
      runId: this.id,
      at: Date.now(),
    };
    this.events.push(enriched);
    return enriched;
  }
}
