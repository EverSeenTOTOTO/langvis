import type { Response } from 'express';
import { SSEMessage } from '@/shared/types';
import logger from '../utils/logger';

const HEARTBEAT_INTERVAL_MS = 10_000;

/**
 * Encapsulates SSE connection lifecycle and technical details.
 * Responsible for: writeHead, heartbeat, sending events, and cleanup.
 */
export class SSEConnection {
  private heartbeat: ReturnType<typeof setInterval>;
  private closed = false;

  constructor(
    readonly conversationId: string,
    private response: Response,
  ) {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    this.heartbeat = setInterval(() => {
      if (response.writable && !this.closed) {
        response.write(`data: ${JSON.stringify({ type: 'heartbeat' })}

`);
        response.flush();
      }
    }, HEARTBEAT_INTERVAL_MS);

    // Handshake: send connected event to confirm SSE is ready
    this.send({ type: 'connected', conversationId });
  }

  /**
   * Send an SSE message. Returns false if connection is not writable.
   */
  send(message: SSEMessage): boolean {
    if (this.closed || !this.response.writable) return false;

    const payload = `data: ${JSON.stringify(message)}

`;
    const flushed = this.response.write(payload);
    this.response.flush();

    if (!flushed) {
      logger.warn(`Backpressure on SSE write for ${this.conversationId}`);
    }

    return !!flushed;
  }

  /**
   * Check if the underlying connection is still writable.
   */
  get isWritable(): boolean {
    return !this.closed && this.response.writable;
  }

  /**
   * Close the SSE connection and stop heartbeat.
   */
  close(): void {
    if (this.closed) return;
    this.closed = true;

    clearInterval(this.heartbeat);

    if (!this.response.writableEnded) {
      this.response.end();
    }
  }
}
