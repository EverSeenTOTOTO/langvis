import type { SessionPhase } from '@/shared/types';
import type { SSEFrame } from '@/shared/types/events';
import { Transport } from '@/shared/transport';
import {
  SESSION_PHASE_TRANSITIONS,
  StateMachine,
} from '@/shared/utils/StateMachine';
import logger from '../utils/logger';
import type { AgentRun } from '../modules/agent/domain/agent-run.entity';

export interface SessionFSMEventMap {
  transition: CustomEvent<{ from: SessionPhase; to: SessionPhase }>;
  dispose: CustomEvent<string>;
}

export class SessionFSM {
  readonly conversationId: string;
  readonly createdAt = Date.now();

  private sm: StateMachine<SessionPhase>;
  private transport: Transport<SSEFrame> | null = null;
  private runs = new Map<string, AgentRun>();
  private idleTimeout: ReturnType<typeof setTimeout>;

  constructor(conversationId: string, idleTimeoutMs: number) {
    this.conversationId = conversationId;

    this.sm = new StateMachine({
      initialPhase: 'waiting',
      transitions: SESSION_PHASE_TRANSITIONS,
    });

    this.sm.addEventListener('transition', e => {
      const { from, to } = (e as CustomEvent).detail;
      if (to !== 'waiting') clearTimeout(this.idleTimeout);
      logger.info(`Session phase changed: ${from} -> ${to}`, {
        sessionId: this.conversationId,
      });
    });

    this.idleTimeout = setTimeout(() => {
      if (this.phase === 'waiting') {
        logger.warn(
          `Session ${this.conversationId} idle timeout after ${idleTimeoutMs}ms`,
        );
        this.cleanup().catch(err =>
          logger.error(`Failed to cleanup session on idle timeout:`, err),
        );
      }
    }, idleTimeoutMs);
  }

  get phase(): SessionPhase {
    return this.sm.phase;
  }

  addEventListener<K extends keyof SessionFSMEventMap>(
    type: K,
    listener: (ev: SessionFSMEventMap[K]) => void,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    this.sm.addEventListener(type, listener);
  }

  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    this.sm.removeEventListener(type, listener);
  }

  attachTransport(newTransport: Transport<SSEFrame>): void {
    if (this.transport) {
      this.transport.disconnect();
      logger.info(`Kicked old transport for ${this.conversationId}`);
    }

    this.transport = newTransport;

    for (const [messageId, run] of this.runs) {
      if (!run.isTerminated) {
        for (const event of run.bufferedEvents) {
          const frame = { ...event, messageId } as SSEFrame;
          newTransport.send(frame);
        }
        logger.info(
          `Replayed ${run.bufferedEvents.length} events for message ${messageId}`,
          { sessionId: this.conversationId, messageId },
        );
      }
    }

    logger.info(`Transport attached with event replay`, {
      sessionId: this.conversationId,
    });
  }

  registerRun(run: AgentRun): void {
    this.runs.set(run.messageId, run);
    this.updatePhase();
  }

  getRun(messageId: string): AgentRun | undefined {
    return this.runs.get(messageId);
  }

  cancelMessage(messageId: string): void {
    const run = this.runs.get(messageId);
    if (run && !run.isTerminated) {
      try {
        run.cancel('Cancelled by user');
      } catch {
        // Run already terminated
      }
      this.updatePhase();
    }
  }

  cancelAllMessages(reason: string): void {
    logger.info(`Canceling all messages for ${this.conversationId}: ${reason}`);

    for (const run of this.runs.values()) {
      if (!run.isTerminated) {
        try {
          run.cancel(reason);
        } catch {
          // Run already terminated
        }
      }
    }

    this.sm.transition('canceling');
    this.updatePhase();
  }

  async handleDisconnect(): Promise<void> {
    logger.info(`SSE disconnected for ${this.conversationId}`);

    this.transport = null;

    if (this.phase === 'waiting') {
      await this.cleanup();
    }
  }

  send(event: SSEFrame): boolean {
    if (!this.transport?.isConnected) return false;
    return this.transport.send(event);
  }

  async cleanup(): Promise<void> {
    clearTimeout(this.idleTimeout);
    this.sm.transition('done');

    this.transport?.close();
    this.transport = null;
    this.runs.clear();

    this.sm.dispatchEvent(
      new CustomEvent('dispose', { detail: this.conversationId }),
    );
  }

  private updatePhase(): void {
    const hasActive = Array.from(this.runs.values()).some(
      run => !run.isTerminated,
    );

    if (hasActive && this.phase === 'waiting') {
      this.sm.transition('active');
    } else if (!hasActive && this.phase === 'active') {
      this.sm.transition('waiting');
    } else if (!hasActive && this.phase === 'canceling') {
      this.cleanup().catch(err =>
        logger.error(`Failed to cleanup after cancel:`, err),
      );
    }
  }
}
