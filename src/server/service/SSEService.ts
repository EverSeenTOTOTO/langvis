import type { Response } from 'express';
import { service } from '../decorator/service';

export interface SSEConnection {
  conversationId: string;
  response: Response;
  heartbeat: ReturnType<typeof setInterval>;
}

@service()
export class SSEService {
  /**
   * Initialize SSE connection and send 'connected' handshake event
   * Note: Connection lifecycle is managed by ChatSession, not here
   */
  initSSEConnection(conversationId: string, response: Response): SSEConnection {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const heartbeat = setInterval(() => {
      if (response.writable) {
        response.write(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`);
        response.flush();
      }
    }, 10_000);

    const connection: SSEConnection = {
      conversationId,
      response,
      heartbeat,
    };

    // Handshake: send connected event to confirm SSE is ready
    response.write(
      `data: ${JSON.stringify({ type: 'connected', conversationId })}\n\n`,
    );
    response.flush();

    return connection;
  }
}
