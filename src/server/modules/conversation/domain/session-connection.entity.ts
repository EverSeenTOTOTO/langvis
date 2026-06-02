import type { SSEFrame } from '@/shared/types/events';
import type { Transport } from '@/shared/transport';
import { Entity } from '@/server/libs/ddd';
import logger from '@/server/utils/logger';

/**
 * SessionConnection — 会话的 SSE 连接管理实体。
 *
 * 支持多个 SSE 连接同时存活（多标签页场景），事件广播到所有连接。
 * 单个 transport 断连时不发送 session_replaced（使用 close() 而非 disconnect()）。
 */
export class SessionConnection extends Entity<string> {
  private transports = new Set<Transport<SSEFrame>>();
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly idleTimeout: number;
  private readonly onDispose: () => void;

  get connectedCount(): number {
    return this.transports.size;
  }

  get conversationId(): string {
    return this.id;
  }

  constructor(
    conversationId: string,
    idleTimeout: number,
    onDispose: () => void,
  ) {
    super(conversationId);
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
