import { SSEMessage } from '@/shared/types';
import type { Response } from 'express';
import { service } from '../decorator/service';
import Logger from '../utils/logger';

interface SSEConnection {
  conversationId: string;
  response: any;
}

@service()
export class SSEService {
  private sseConnections: Map<string, SSEConnection> = new Map();
  private heartbeats: Map<string, NodeJS.Timeout> = new Map();
  private readonly logger = Logger.child({ source: 'SSEService' });

  initSSEConnection(conversationId: string, response: Response) {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    const connection: SSEConnection = {
      conversationId,
      response,
    };

    this.sseConnections.set(conversationId, connection);
    // Setup heartbeat
    const heartbeat = setInterval(() => {
      if (response.writable) {
        response.write(
          `data: ${JSON.stringify({ type: 'heartbeat' } as SSEMessage)}\n\n`,
        );
        response.flush();
      }
    }, 10_000); // Every 10 seconds

    this.heartbeats.set(conversationId, heartbeat);

    response.write(
      `data: ${JSON.stringify({ type: 'heartbeat' } as SSEMessage)}\n\n`,
    );
    // flush is required with compresss middleware
    response.flush();

    return connection;
  }

  closeSSEConnection(conversationId: string) {
    const connection = this.sseConnections.get(conversationId);

    if (!connection) return;

    const heartbeat = this.heartbeats.get(conversationId);

    if (heartbeat) {
      clearInterval(heartbeat);
      this.heartbeats.delete(conversationId);
    }

    if (!connection.response.writableEnded) {
      connection.response.end();
    }

    this.sseConnections.delete(conversationId);
  }

  sendToConversation(conversationId: string, msg: SSEMessage) {
    const response = this.sseConnections.get(conversationId)?.response;

    if (!response?.writable) {
      this.closeSSEConnection(conversationId);
      this.logger.warn(
        `SSE connection for conversation ${conversationId} is not writable`,
      );
      return;
    }

    response.write(`data: ${JSON.stringify(msg)}\n\n`);
    response.flush();
  }
}
