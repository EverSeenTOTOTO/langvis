import type { SessionPhase } from '@/shared/types';
import type { PendingMessageSnapshot } from '@/shared/types/render';
import { DuplicateRunError } from './conversation.errors';
import { AggregateRoot, createDomainEvent } from '@/server/libs/ddd';
import logger from '@/server/utils/logger';
import { PendingMessage } from './pending-message';
import type { RunEvent } from './pending-message';

/**
 * Conversation — 会话聚合根。
 *
 * 只管理会话生命周期状态（phase + activeMessageIds），
 * 通过领域事件通知外部。不持有 AgentRun、Transport 等引用。
 *
 * 领域事件：turn_started, turn_completed, turn_cancellation_requested,
 *           conversation_disposed, phase_changed
 */
export class Conversation extends AggregateRoot<string> {
  readonly createdAt = Date.now();

  private _phase: SessionPhase = 'waiting';
  private _disposed = false;
  private activeMessageIds = new Set<string>();
  private pendingMessage?: PendingMessage;

  constructor(id: string) {
    super(id);
  }

  // ════════════════════════════════════════
  // 状态查询
  // ════════════════════════════════════════

  get phase(): SessionPhase {
    if (this._disposed) return 'done';
    return this._phase;
  }

  get isActive(): boolean {
    return !this._disposed && this.activeMessageIds.size > 0;
  }

  get isDisposed(): boolean {
    return this._disposed;
  }

  // ════════════════════════════════════════
  // 生命周期方法
  // ════════════════════════════════════════

  startTurn(messageId: string): void {
    if (this.activeMessageIds.has(messageId)) {
      throw new DuplicateRunError(messageId);
    }
    this.activeMessageIds.add(messageId);
    this.pendingMessage = new PendingMessage(messageId);
    this.transitionPhase('active');
    this.addEvent(createDomainEvent('turn_started', this.id, { messageId }));
  }

  completeTurn(messageId: string): void {
    this.activeMessageIds.delete(messageId);
    this.pendingMessage = undefined;
    this.addEvent(createDomainEvent('turn_completed', this.id, { messageId }));
    if (this.activeMessageIds.size === 0) {
      this.transitionPhase('waiting');
    }
  }

  handleRunEvent(event: RunEvent): void {
    this.pendingMessage?.handleEvent(event);
  }

  getPendingSnapshot(): PendingMessageSnapshot | undefined {
    return this.pendingMessage?.toSnapshot();
  }

  requestCancellation(messageId?: string, reason?: string): void {
    if (this._disposed) return;

    if (messageId) {
      this.addEvent(
        createDomainEvent('turn_cancellation_requested', this.id, {
          messageId,
          reason: reason ?? 'Cancelled by user',
        }),
      );
    } else {
      this.transitionPhase('canceling');
      for (const id of this.activeMessageIds) {
        this.addEvent(
          createDomainEvent('turn_cancellation_requested', this.id, {
            messageId: id,
            reason: reason ?? 'Cancelled by user',
          }),
        );
      }
    }
  }

  dispose(): void {
    if (this._disposed) return;

    this._disposed = true;
    this.activeMessageIds.clear();
    this.transitionPhase('done');
    this.addEvent(createDomainEvent('conversation_disposed', this.id, {}));
  }

  hasActiveMessage(messageId: string): boolean {
    return this.activeMessageIds.has(messageId);
  }

  // ── 内部 ──

  private transitionPhase(newPhase: SessionPhase): void {
    if (newPhase === this._phase) return;
    const from = this._phase;
    logger.info(`Session phase changed: ${from} -> ${newPhase}`, {
      sessionId: this.id,
    });
    this._phase = newPhase;
    this.addEvent(
      createDomainEvent('phase_changed', this.id, { from, to: newPhase }),
    );
  }
}
