import type { SSEFrame, EnrichedEvent } from '@/shared/types/events';
import type { Transport } from '@/shared/transport';
import { Connection } from './connection';
import { projectRun } from './run-projection';
import {
  ConversationMemory,
  type ConversationMemoryConfig,
} from '../../domain/model/conversation-memory';
import type { Message } from '@/shared/types/entities';
import Logger from '@/server/utils/logger';

/** 活跃 run 的会话内追踪——只持 runId + 事件缓冲，不持 agent 的 AgentRun 聚合。 */
export interface ActiveRun {
  runId: string;
  events: EnrichedEvent[];
}

const logger = Logger.child({ source: 'ConversationSession' });

/**
 * ConversationSession —— 单个活跃会话的运行时态（瞬态、进程内，SessionManager 以 conversationId 索引）。
 *
 * 持有该会话的：传输层连接（Connection，多标签 SSE + idle timer）、活跃 run 簿记（activeRuns）、
 * 会话记忆（ConversationMemory——有效历史投影 + 用量）。对应 agent 侧的 AgentRunContext——per-scope
 * 运行时对象，非持久聚合。conversationId 是隐式 this，故本类方法不再带 conversationId 形参。
 * SessionManager 退化为 registry，经 conversationId 解析本对象后委托。
 */
export class ConversationSession {
  private connection: Connection | undefined;
  private readonly activeRuns = new Map<string, ActiveRun>();
  private memory: ConversationMemory | undefined;
  private memoryConfig: ConversationMemoryConfig | undefined;

  constructor(
    readonly conversationId: string,
    private readonly idleTimeout: number,
    /** 连接释放（idle 超时 / 显式 dispose）时回调 registry 做会话级清理（disposeChat）。 */
    private readonly onConnectionLost: () => void,
  ) {}

  get hasConnection(): boolean {
    return this.connection !== undefined;
  }

  // ── 传输 ──

  /**
   * attach 传输（多标签可重复 attach 同一会话）。首次 attach 建 Connection；
   * 连接 idle 自释放时经 onConnectionLost 回调 registry.disposeChat。
   * attach 后对本进程缓冲的活跃 run 补发 state_snapshot（重连同一进程的活跃 run）。
   */
  attachTransport(transport: Transport<SSEFrame>): void {
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
      );
    }
    this.connection.attach(transport);

    for (const [messageId, run] of this.activeRuns) {
      const view = projectRun(run.events);
      this.connection.send({
        type: 'state_snapshot',
        messageId,
        content: view.content,
        steps: view.steps,
        status: view.status,
        awaitingInput: view.awaitingInput,
      } as SSEFrame);
      logger.info(
        `Replayed snapshot: ${view.content.length} chars, ${view.steps.length} steps`,
        { chatId: this.conversationId, messageId },
      );
    }

    logger.info(`Transport attached`, { chatId: this.conversationId });
  }

  sendFrame(frame: SSEFrame): boolean {
    return this.connection?.send(frame) ?? false;
  }

  markIdle(): void {
    this.connection?.markIdle();
  }

  // ── run 簿记 ──

  registerRun(messageId: string, runId: string): void {
    this.activeRuns.set(messageId, { runId, events: [] });
  }

  hasActiveRun(messageId: string): boolean {
    return this.activeRuns.has(messageId);
  }

  getRunEvents(messageId: string): readonly EnrichedEvent[] | undefined {
    return this.activeRuns.get(messageId)?.events;
  }

  getRun(messageId: string): ActiveRun | undefined {
    return this.activeRuns.get(messageId);
  }

  runMessageIds(): string[] {
    return [...this.activeRuns.keys()];
  }

  /** 所有 run 的 runId（供 registry dispose 时清 runIndex）。 */
  runIds(): string[] {
    return [...this.activeRuns.values()].map(r => r.runId);
  }

  get hasNoRuns(): boolean {
    return this.activeRuns.size === 0;
  }

  handleRunEvent(messageId: string, event: EnrichedEvent): void {
    const run = this.activeRuns.get(messageId);
    if (run) run.events.push(event);
    this.sendFrame({ ...event, messageId } as SSEFrame);
  }

  /** 移除 run；返回其 runId 供 registry 清 runIndex。 */
  removeRun(messageId: string): string | undefined {
    const run = this.activeRuns.get(messageId);
    if (!run) return undefined;
    this.activeRuns.delete(messageId);
    return run.runId;
  }

  // ── 会话记忆（ConversationMemory 成员）──

  /** 激活：一次性灌入当前消息 + 配置，构造会话记忆投影。 */
  activateMemory(messages: Message[], config: ConversationMemoryConfig): void {
    this.memory = new ConversationMemory({
      history: messages,
      contextSize: config.contextSize,
      modelId: config.modelId,
    });
    this.memoryConfig = config;
  }

  hasMemory(): boolean {
    return this.memory !== undefined;
  }

  getMemory(): ConversationMemory {
    if (!this.memory) {
      throw new Error(
        `ConversationMemory: ${this.conversationId} not activated (activateMemory missing)`,
      );
    }
    return this.memory;
  }

  getMemoryConfig(): ConversationMemoryConfig {
    if (!this.memoryConfig) {
      throw new Error(
        `ConversationMemory: ${this.conversationId} not activated (activateMemory missing)`,
      );
    }
    return this.memoryConfig;
  }

  dispose(): void {
    this.connection?.dispose();
    this.connection = undefined;
    this.activeRuns.clear();
    this.memory = undefined;
    this.memoryConfig = undefined;
  }
}
