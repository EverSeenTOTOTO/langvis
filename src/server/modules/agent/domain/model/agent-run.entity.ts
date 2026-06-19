import { RuntimeConfigVO } from './runtime-config.vo';
import type { EnrichedEvent, RunEvent } from '@/shared/types/events';
import { RunAlreadyCompletedError } from '../errors';
import { AggregateRoot } from '@/server/libs/ddd';
import type { RunStatus } from '@/shared/types/agent';

export class AgentRun extends AggregateRoot<string> {
  readonly agentId: string;
  readonly config: RuntimeConfigVO;

  private status: RunStatus = 'initialized';
  private events: EnrichedEvent[] = [];
  #terminated = false;
  private seq = 0;
  private readonly abortController = new AbortController();

  get runId(): string {
    return this.id;
  }
  get currentStatus(): RunStatus {
    return this.status;
  }
  get isTerminated(): boolean {
    return this.#terminated;
  }
  /** 唯一暴露事件流的方式 —— 给投影/持久化用 */
  get eventStream(): readonly EnrichedEvent[] {
    return this.events;
  }
  /** 取消句柄 —— agent/tool 经 AgentRunContext.signal 读取 */
  get signal(): AbortSignal {
    return this.abortController.signal;
  }

  constructor(runId: string, agentId: string, config: RuntimeConfigVO) {
    super(runId);
    this.agentId = agentId;
    this.config = config;
  }

  /**
   * 记录 agent yield 的事实 —— 唯一带终止守卫的入口。
   * 注入 seq/at 元数据后追加，返回富化事件供传输层推送。
   * 已终止则返回 null（静默丢弃，不抛异常以兼容外部 cancel 与执行循环的竞态）。
   */
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

  private record(event: RunEvent): EnrichedEvent {
    const enriched: EnrichedEvent = {
      ...event,
      runId: this.id,
      seq: ++this.seq,
      at: Date.now(),
    };
    this.events.push(enriched);
    return enriched;
  }
}
