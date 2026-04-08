import { AgentEvent, MessagePhase, SessionPhase } from '@/shared/types';
import logger from '../utils/logger';
import { MessageFSM } from './MessageFSM';
import type { PendingMessage } from './PendingMessage';
import { SSEConnection } from './SSEConnection';
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

  private sm: StateMachine<SessionPhase>;
  private sseConnection: SSEConnection | null = null;
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

  bindConnection(connection: SSEConnection): void {
    // 1. Close old connection if exists
    if (this.sseConnection) {
      this.sseConnection.send({ type: 'session_replaced' });
      this.sseConnection.close();
      logger.info(`Kicked old SSE connection for ${this.conversationId}`);
    }

    // 2. Replay accumulated events from all non-terminal MessageFSMs
    for (const [messageId, messageFSM] of this.messageFSMs) {
      if (!messageFSM.isTerminated) {
        const events = messageFSM.pendingMessage.events;
        for (const event of events) {
          connection.send(event);
        }
        logger.info(
          `Replayed ${events.length} events for message ${messageId}`,
          { sessionId: this.conversationId, messageId },
        );
      }
    }

    // 3. Bind new connection
    this.sseConnection = connection;

    // 4. Send handshake to signal replay completion
    connection.handshake();
    logger.info(`SSE connection established with event replay`, {
      sessionId: this.conversationId,
    });
  }

  addMessageFSM(messageId: string, pendingMessage: PendingMessage): MessageFSM {
    const fsm = new MessageFSM(messageId, pendingMessage, {
      onTransition: (id, from, to) => this.onMessagePhaseChange(id, from, to),
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
    if (!this.sseConnection?.isWritable) return false;
    return this.sseConnection.send(event as AgentEvent);
  }

  async cleanup(): Promise<void> {
    clearTimeout(this.idleTimeout);
    this.sm.transition('done');

    this.sseConnection?.close();
    this.sseConnection = null;
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
