import type { StreamFrame, EnrichedEvent } from '@/shared/types/events';
import type { Transport } from '@/shared/transport';
import { Connection } from './connection';
import { ActiveRun } from './active-run';
import type { Message } from '@/shared/types/entities';
import Logger from '@/server/utils/logger';
import { ListMonad } from '@/server/libs/list';
import type { ConversationConfig } from '@/server/libs/config';
import {
  ConvTransformPlan,
  type ConversationContext,
} from '../../domain/model/conv-transform';

const logger = Logger.child({ source: 'ConversationSession' });

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

  /** 活跃 run 的 live 投影文案（turn 收尾持久化用，免重 fold）。 */
  getFinalContent(messageId: string): string | undefined {
    return this.activeRuns.get(messageId)?.getFinalContent();
  }

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
    this.activeRuns.get(messageId)?.handleEvent(event);
  }

  flushRunView(messageId: string): void {
    this.activeRuns.get(messageId)?.flush();
  }

  removeRun(messageId: string): void {
    this.activeRuns.get(messageId)?.flush();
    this.activeRuns.delete(messageId);
  }

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
