import {
  AgentEvent,
  MessagePhase,
  SSEMessage,
  SessionPhase,
} from '@/shared/types';
import { Transport } from '@/shared/transport';
import { StateMachine } from '@/shared/utils/StateMachine';
import logger from '../utils/logger';
import { Memory } from './memory';
import { MessageFSM } from './MessageFSM';
import { PendingMessage } from './PendingMessage';

const VALID_TRANSITIONS: Record<SessionPhase, SessionPhase[]> = {
  waiting: ['active', 'done'],
  active: ['waiting', 'canceling', 'error', 'done'],
  canceling: ['done', 'error'],
  error: ['done'],
  done: [],
};

export interface SessionFSMEventMap {
  transition: CustomEvent<{ from: SessionPhase; to: SessionPhase }>;
  dispose: CustomEvent<string>;
}

export class SessionFSM {
  readonly conversationId: string;
  readonly createdAt = Date.now();

  private _memory?: Memory;
  private sm: StateMachine<SessionPhase>;
  private transport: Transport<SSEMessage> | null = null;
  private messageFSMs = new Map<string, MessageFSM>();
  private idleTimeout: ReturnType<typeof setTimeout>;

  constructor(conversationId: string, idleTimeoutMs: number) {
    this.conversationId = conversationId;

    this.sm = new StateMachine({
      initialPhase: 'waiting',
      transitions: VALID_TRANSITIONS,
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

  get memory(): Memory | undefined {
    return this._memory;
  }

  setMemory(memory: Memory): void {
    this._memory = memory;
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

  attachTransport(newTransport: Transport<SSEMessage>): void {
    if (this.transport) {
      this.transport.disconnect();
      logger.info(`Kicked old transport for ${this.conversationId}`);
    }

    this.transport = newTransport;

    for (const [messageId, messageFSM] of this.messageFSMs) {
      if (!messageFSM.isTerminated) {
        const events = messageFSM.getReplayEvents();
        for (const event of events) {
          newTransport.send(event);
        }
        logger.info(
          `Replayed ${events.length} events for message ${messageId}`,
          { sessionId: this.conversationId, messageId },
        );
      }
    }

    logger.info(`Transport attached with event replay`, {
      sessionId: this.conversationId,
    });
  }

  addMessageFSM(messageId: string, pendingMessage: PendingMessage): MessageFSM {
    const fsm = new MessageFSM(messageId, pendingMessage);

    fsm.addEventListener('transition', e => {
      const { to } = (
        e as CustomEvent<{ from: MessagePhase; to: MessagePhase }>
      ).detail;
      this.onMessagePhaseChange(messageId, to);
    });

    this.messageFSMs.set(messageId, fsm);
    return fsm;
  }

  getMessageFSM(messageId: string): MessageFSM | undefined {
    return this.messageFSMs.get(messageId);
  }

  cancelMessage(messageId: string): void {
    const fsm = this.messageFSMs.get(messageId);
    if (fsm && !fsm.isTerminated) {
      fsm.cancel();
    }
  }

  cancelAllMessages(reason: string): void {
    logger.info(`Canceling all messages for ${this.conversationId}: ${reason}`);

    for (const fsm of this.messageFSMs.values()) {
      if (!fsm.isTerminated) {
        fsm.cancel();
      }
    }

    this.sm.transition('canceling');
  }

  async handleDisconnect(): Promise<void> {
    logger.info(`SSE disconnected for ${this.conversationId}`);

    this.transport = null;

    if (this.phase === 'waiting') {
      await this.cleanup();
    }
  }

  send(event: AgentEvent | { type: string; [key: string]: unknown }): boolean {
    if (!this.transport?.isConnected) return false;
    return this.transport.send(event as SSEMessage);
  }

  async cleanup(): Promise<void> {
    clearTimeout(this.idleTimeout);
    this.sm.transition('done');

    this.transport?.close();
    this.transport = null;
    this.messageFSMs.clear();
    this._memory = undefined;

    this.sm.dispatchEvent(
      new CustomEvent('dispose', { detail: this.conversationId }),
    );
  }

  private onMessagePhaseChange(_messageId: string, _to: MessagePhase): void {
    const hasActive = Array.from(this.messageFSMs.values()).some(
      fsm => fsm.isActive,
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
