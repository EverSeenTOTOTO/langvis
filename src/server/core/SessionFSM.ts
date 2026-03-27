import { AgentEvent } from '@/shared/types';
import logger from '../utils/logger';
import { MessageFSM, MessagePhase } from './MessageFSM';
import type { PendingMessage } from './PendingMessage';
import { SSEConnection } from './SSEConnection';

export type SessionPhase =
  | 'waiting'
  | 'active'
  | 'canceling'
  | 'error'
  | 'done';

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

  phase: SessionPhase = 'waiting';
  private sseConnection: SSEConnection | null = null;
  private messageFSMs = new Map<string, MessageFSM>();
  private idleTimeout: ReturnType<typeof setTimeout>;
  private options: SessionFSMOptions;

  constructor(conversationId: string, options: SessionFSMOptions) {
    this.conversationId = conversationId;
    this.options = options;
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

  bindConnection(connection: SSEConnection): void {
    // Kick old connection if exists
    if (this.sseConnection) {
      this.sseConnection.send({ type: 'session_replaced' });
      this.sseConnection.close();
      logger.info(`Kicked old SSE connection for ${this.conversationId}`);
    }
    this.sseConnection = connection;
  }

  addMessageFSM(messageId: string, pendingMessage: PendingMessage): MessageFSM {
    const fsm = new MessageFSM(messageId, pendingMessage, {
      onPhaseChange: (id, phase) => this.onMessagePhaseChange(id, phase),
    });
    this.messageFSMs.set(messageId, fsm);
    return fsm;
  }

  getMessageFSM(messageId: string): MessageFSM | undefined {
    return this.messageFSMs.get(messageId);
  }

  cancelMessage(messageId: string): void {
    const fsm = this.messageFSMs.get(messageId);
    if (fsm && !fsm.isTerminal) {
      fsm.cancel();
    }
  }

  cancelAllMessages(reason: string): void {
    logger.info(`Canceling all messages for ${this.conversationId}: ${reason}`);

    for (const fsm of this.messageFSMs.values()) {
      if (!fsm.isTerminal) {
        fsm.cancel();
      }
    }

    this.transition('canceling');
  }

  async handleDisconnect(): Promise<void> {
    logger.info(`SSE disconnected for ${this.conversationId}`);

    // Persist all active messages
    for (const fsm of this.messageFSMs.values()) {
      if (!fsm.isTerminal) {
        await fsm.persist();
      }
    }

    // If in waiting phase, cleanup
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
    await this.transition('done');

    this.sseConnection?.close();
    this.sseConnection = null;
    this.messageFSMs.clear();

    await this.options.onDispose(this.conversationId);
  }

  private async transition(to: SessionPhase): Promise<boolean> {
    if (!VALID_TRANSITIONS[this.phase].includes(to)) return false;

    const from = this.phase;
    this.phase = to;

    logger.info(`Session phase changed: ${from} -> ${to}`, {
      sessionId: this.conversationId,
    });

    if (to !== 'waiting') {
      clearTimeout(this.idleTimeout);
    }

    await this.options.onPhaseChange?.(this.conversationId, to);

    return true;
  }

  private async onMessagePhaseChange(
    _messageId: string,
    _phase: MessagePhase,
  ): Promise<void> {
    const hasActive = Array.from(this.messageFSMs.values()).some(
      fsm => !fsm.isTerminal,
    );

    if (hasActive && this.phase === 'waiting') {
      await this.transition('active');
    } else if (!hasActive && this.phase === 'active') {
      await this.transition('waiting');
    } else if (!hasActive && this.phase === 'canceling') {
      // All messages reached terminal, we're done
      await this.cleanup();
    }
  }
}
