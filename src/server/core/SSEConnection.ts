import type { Response } from 'express';
import { SSEMessage } from '@/shared/types';
import logger from '../utils/logger';

const HEARTBEAT_INTERVAL_MS = 10_000;

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

  get isWritable(): boolean {
    return !this.closed && this.response.writable;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;

    clearInterval(this.heartbeat);

    if (!this.response.writableEnded) {
      this.response.end();
    }
  }
}
