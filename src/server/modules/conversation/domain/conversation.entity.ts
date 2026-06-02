import type { SSEFrame } from '@/shared/types/events';
import type { RunSnapshot } from '@/shared/types/render';
import type { SessionPhase } from '@/shared/types';
import type { Message } from '@/shared/types/entities';
import type { Transport } from '@/shared/transport';
import type { AgentRun } from '@/server/modules/agent/domain/agent-run.entity';
import type { SessionConnection } from './session-connection.entity';
import { DuplicateRunError, NoActiveRunError } from './conversation.errors';
import { SessionConnection as SessionConnectionClass } from './session-connection.entity';
import { AggregateRoot, createDomainEvent } from '@/server/libs/ddd';
import logger from '@/server/utils/logger';

type ActiveEntry = { message: Message; run: AgentRun };

/**
 * Conversation — 会话聚合根。
 *
 * 替换 SessionFSM。管理 SSE 连接（多标签页）+ AgentRun 注册/取消/终结。
 * phase 由 run 状态派生，不使用 StateMachine。
 *
 * 领域事件：phase_changed, conversation_disposed
 */
export class Conversation extends AggregateRoot<string> {
  readonly createdAt = Date.now();

  private connection: SessionConnection | null = null;
  private activeEntries = new Map<string, ActiveEntry>();
  private _disposed = false;
  private _cancelingRequested = false;
  private _lastPhase: SessionPhase = 'waiting';
  private readonly idleTimeoutMs: number;

  constructor(
    id: string,
    opts?: {
      idleTimeoutMs?: number;
    },
  ) {
    super(id);
    this.idleTimeoutMs = opts?.idleTimeoutMs ?? 30_000;
  }

  // ════════════════════════════════════════
  // 派生状态（替代 StateMachine）
  // ════════════════════════════════════════

  get phase(): SessionPhase {
    if (this._disposed) return 'done';

    const hasActive = Array.from(this.activeEntries.values()).some(
      ({ run }) => !run.isTerminated,
    );

    if (this._cancelingRequested) {
      return hasActive ? 'canceling' : 'done';
    }

    return hasActive ? 'active' : 'waiting';
  }

  get isActive(): boolean {
    return (
      !this._disposed &&
      Array.from(this.activeEntries.values()).some(
        ({ run }) => !run.isTerminated,
      )
    );
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  get connectedClientCount(): number {
    return this.connection?.connectedCount ?? 0;
  }

  // ════════════════════════════════════════
  // 连接管理
  // ════════════════════════════════════════

  attachTransport(transport: Transport<SSEFrame>): void {
    if (!this.connection) {
      this.connection = new SessionConnectionClass(
        this.id,
        this.idleTimeoutMs,
        () => {
          this.dispose();
        },
      );
    }

    this.connection.attach(transport);

    for (const [messageId, entry] of this.activeEntries) {
      if (!entry.run.isTerminated) {
        for (const event of entry.run.bufferedEvents) {
          const frame = { ...event, messageId } as SSEFrame;
          transport.send(frame);
        }
        logger.info(
          `Replayed ${entry.run.bufferedEvents.length} events for message ${messageId}`,
          { sessionId: this.id, messageId },
        );
      }
    }

    logger.info(`Transport attached with event replay`, {
      sessionId: this.id,
    });
  }

  send(frame: SSEFrame): boolean {
    return this.connection?.send(frame) ?? false;
  }

  // ════════════════════════════════════════
  // AgentRun 生命周期
  // ════════════════════════════════════════

  registerRun(message: Message, run: AgentRun): void {
    if (this.activeEntries.has(message.id)) {
      throw new DuplicateRunError(message.id);
    }
    this.activeEntries.set(message.id, { message, run });
    this.notifyPhaseChange();
  }

  finalizeRun(messageId: string): ActiveEntry | undefined {
    const entry = this.activeEntries.get(messageId);
    if (!entry) return undefined;

    this.activeEntries.delete(messageId);

    if (this.activeEntries.size === 0 && this.connection) {
      this.connection.markIdle();
    }

    this.notifyPhaseChange();
    return entry;
  }

  cancelAll(reason?: string): void {
    logger.info(`Canceling all messages for ${this.id}: ${reason}`);

    this._cancelingRequested = true;

    for (const { run } of this.activeEntries.values()) {
      if (!run.isTerminated) {
        try {
          run.cancel(reason ?? 'Cancelled by user');
        } catch {
          // Run already terminated
        }
      }
    }

    this.notifyPhaseChange();
  }

  cancelMessage(messageId: string): void {
    const entry = this.activeEntries.get(messageId);
    if (!entry) throw new NoActiveRunError(messageId);

    if (!entry.run.isTerminated) {
      try {
        entry.run.cancel('Cancelled by user');
      } catch {
        // Run already terminated
      }
    }

    this.notifyPhaseChange();
  }

  getRun(messageId: string): AgentRun | undefined {
    return this.activeEntries.get(messageId)?.run;
  }

  getActiveSnapshots(): RunSnapshot[] {
    return Array.from(this.activeEntries.values()).map(({ run }) =>
      run.toSnapshot(),
    );
  }

  // ════════════════════════════════════════
  // 清理
  // ════════════════════════════════════════

  dispose(): void {
    if (this._disposed) return;

    this._disposed = true;

    for (const { run } of this.activeEntries.values()) {
      if (!run.isTerminated) {
        try {
          run.cancel('Session disposed');
        } catch {
          // Already terminated
        }
      }
    }
    this.activeEntries.clear();

    this.connection?.dispose();
    this.connection = null;

    this.notifyPhaseChange();
    this.addEvent(createDomainEvent('conversation_disposed', this.id, {}));
  }

  // ── 内部 ──

  private notifyPhaseChange(): void {
    const newPhase = this.phase;
    if (newPhase !== this._lastPhase) {
      const from = this._lastPhase;
      logger.info(`Session phase changed: ${from} -> ${newPhase}`, {
        sessionId: this.id,
      });
      this._lastPhase = newPhase;
      this.addEvent(
        createDomainEvent('phase_changed', this.id, { from, to: newPhase }),
      );
    }
  }
}
