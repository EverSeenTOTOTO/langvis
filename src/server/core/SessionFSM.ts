import {
  AgentEvent,
  MessagePhase,
  SSEMessage,
  SessionPhase,
} from '@/shared/types';
import { Transport } from '@/shared/transport';
import logger from '../utils/logger';
import { Memory } from './memory';
import { MessageFSM, type MessageFSMOptions } from './MessageFSM';
import { PendingMessage } from './PendingMessage';
import { StateMachine } from '@/shared/utils/StateMachine';

const VALID_TRANSITIONS: Record<SessionPhase, SessionPhase[]> = {
  waiting: ['active', 'done'],
  active: ['waiting', 'canceling', 'error', 'done'],
  canceling: ['done', 'error'],
  error: ['done'],
  done: [],
};

export interface SessionFSMOptions {
  idleTimeoutMs: number;
  onDispose: (conversationId: string) => Promise<void>;
  onPhaseChange?: (
    conversationId: string,
    phase: SessionPhase,
  ) => Promise<void>;
}

export class SessionFSM {
  readonly conversationId: string;
  readonly createdAt = Date.now();

  private _memory?: Memory;
  private sm: StateMachine<SessionPhase>;
  private transport: Transport<SSEMessage> | null = null;
  private messageFSMs = new Map<string, MessageFSM>();
  private idleTimeout: ReturnType<typeof setTimeout>;
  private options: SessionFSMOptions;

  constructor(conversationId: string, options: SessionFSMOptions) {
    this.conversationId = conversationId;
    this.options = options;

    this.sm = new StateMachine({
      initialPhase: 'waiting',
      transitions: VALID_TRANSITIONS,
      onTransition: (_from, to) => {
        if (to !== 'waiting') clearTimeout(this.idleTimeout);
        logger.info(`Session phase changed: ${_from} -> ${to}`, {
          sessionId: this.conversationId,
        });
        this.options.onPhaseChange?.(this.conversationId, to);
      },
    });

    this.idleTimeout = setTimeout(() => {
      if (this.phase === 'waiting') {
        logger.warn(
          `Session ${this.conversationId} idle timeout after ${this.options.idleTimeoutMs}ms`,
        );
        this.cleanup().catch(err =>
          logger.error(`Failed to cleanup session on idle timeout:`, err),
        );
      }
    }, this.options.idleTimeoutMs);
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

  attachTransport(newTransport: Transport<SSEMessage>): void {
    // 1. Close old transport if exists
    if (this.transport) {
      this.transport.disconnect();
      logger.info(`Kicked old transport for ${this.conversationId}`);
    }

    // 2. Bind new transport (connected already sent by transport on construction)
    this.transport = newTransport;

    // 3. Replay accumulated events from all non-terminal MessageFSMs
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

  addMessageFSM(
    messageId: string,
    pendingMessage: PendingMessage,
    onPersist?: MessageFSMOptions['onPersist'],
  ): MessageFSM {
    const fsm = new MessageFSM(messageId, pendingMessage, {
      onTransition: (id, from, to) => this.onMessagePhaseChange(id, from, to),
      onPersist,
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

    // Always clear transport reference on disconnect — the connection is gone
    this.transport = null;

    for (const fsm of this.messageFSMs.values()) {
      if (!fsm.isTerminated) {
        await fsm.persist();
      }
    }

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

    await this.options.onDispose(this.conversationId);
  }

  private onMessagePhaseChange(
    _messageId: string,
    _from: MessagePhase,
    _to: MessagePhase,
  ): void {
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
