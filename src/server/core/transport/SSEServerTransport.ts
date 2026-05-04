import type { Request, Response } from 'express';
import { Transport } from '@/shared/transport';
import type { SSEMessage } from '@/shared/types';
import logger from '../../utils/logger';

export class SSEServerTransport extends Transport<SSEMessage> {
  private closed = false;

  constructor(
    req: Request,
    private response: Response,
  ) {
    super();

    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    // Send connected immediately — event replay happens at a higher level
    this.send({ type: 'connected' });

    req.on('close', () => {
      this.emit('disconnect');
    });

    req.on('error', err => {
      const isNormalClose =
        err.message === 'aborted' || (err as any).code === 'ECONNRESET';
      if (isNormalClose) {
        this.emit('disconnect');
      } else {
        this.emit('error', err.message);
      }
    });
  }

  connect(): Promise<void> {
    return Promise.resolve();
  }

  send(message: SSEMessage): boolean {
    if (this.closed || !this.response.writable) return false;

    const payload = `data: ${JSON.stringify(message)}\n\n`;
    const flushed = this.response.write(payload);
    this.response.flush();

    if (!flushed) {
      logger.warn(`Backpressure on SSE write`);
    }

    return !!flushed;
  }

  disconnect(): void {
    this.send({ type: 'session_replaced' });
    this.close();
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;

    if (!this.response.writableEnded) {
      this.response.end();
    }
  }

  get isConnecting(): boolean {
    return false;
  }

  get isConnected(): boolean {
    return !this.closed && this.response.writable;
  }
}
