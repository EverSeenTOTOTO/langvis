import type { SSEFrame } from '@/shared/types/events';
import type { Transport } from '@/shared/transport';
import logger from '@/server/utils/logger';

/**
 * SessionConnection — SSE connection manager (application layer).
 *
 * Supports multiple concurrent SSE connections (multi-tab),
 * broadcasting events to all. Not a domain entity — it's an
 * infrastructure component managed by ConversationService.
 */
export class SessionConnection {
  private transports = new Set<Transport<SSEFrame>>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly idleTimeout: number;
  private readonly onDispose: () => void;

  get connectedCount(): number {
    return this.transports.size;
  }

  constructor(
    readonly conversationId: string,
    idleTimeout: number,
    onDispose: () => void,
  ) {
    this.idleTimeout = idleTimeout;
    this.onDispose = onDispose;
  }

  attach(transport: Transport<SSEFrame>): void {
    this.transports.add(transport);
    this.clearIdleTimer();

    transport.addEventListener('disconnect', () => {
      this.transports.delete(transport);
      if (this.transports.size === 0) {
        this.resetIdleTimer();
      }
    });
  }

  send(frame: SSEFrame): boolean {
    if (this.transports.size === 0) return false;

    let anySent = false;
    for (const transport of this.transports) {
      if (transport.isConnected) {
        transport.send(frame);
        anySent = true;
      }
    }
    return anySent;
  }

  markIdle(): void {
    if (this.transports.size === 0) {
      this.resetIdleTimer();
    }
  }

  dispose(): void {
    this.clearIdleTimer();

    for (const transport of this.transports) {
      transport.close();
    }
    this.transports.clear();

    this.onDispose();
  }

  private resetIdleTimer(): void {
    this.clearIdleTimer();
    this.idleTimer = setTimeout(() => {
      logger.info(
        `SessionConnection idle timeout after ${this.idleTimeout}ms`,
        { sessionId: this.conversationId },
      );
      this.dispose();
    }, this.idleTimeout);
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = null;
    }
  }
}
