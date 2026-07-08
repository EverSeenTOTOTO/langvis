import type { Request, Response } from 'express';
import { Transport } from '@/shared/transport';
import type { SSEFrame } from '@/shared/types/events';
import logger from '@/server/utils/logger';

/** SSE 心跳间隔——非流式 LLM 调用期间无业务帧，靠注释行保活以防代理 idle 断连。 */
const SSE_HEARTBEAT_MS = 20_000;

export class SSEServerTransport extends Transport<SSEFrame> {
  private closed = false;
  private disconnected = false;
  private heartbeat: ReturnType<typeof setInterval> | null = null;

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

    // 注释行心跳：业务无帧时段（如非流式 LLM 调用）持续写字节，防止代理读超时断连。
    // 以 `:` 开头的行是 SSE 注释，原生 EventSource 会忽略，前端无需改动。
    this.heartbeat = setInterval(() => {
      if (this.closed || !this.response.writable) return;
      this.response.write(': ping\n\n');
      this.response.flush();
    }, SSE_HEARTBEAT_MS);

    req.on('close', () => {
      this.markDisconnect();
    });

    req.on('error', err => {
      const isNormalClose =
        err.message === 'aborted' || (err as any).code === 'ECONNRESET';
      if (isNormalClose) {
        this.markDisconnect();
      } else {
        this.emit('error', err.message);
      }
    });
  }

  private markDisconnect(): void {
    if (this.disconnected) return;
    this.disconnected = true;
    this.emit('disconnect');
  }

  connect(): Promise<void> {
    return Promise.resolve();
  }

  send(message: SSEFrame): boolean {
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

    if (this.heartbeat) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }

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
