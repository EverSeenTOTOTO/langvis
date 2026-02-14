import { AgentEvent } from '@/shared/types';
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

    response.write('\n');
    response.flush();

    return connection;
  }

  closeSSEConnection(conversationId: string) {
    const connection = this.sseConnections.get(conversationId);

    if (!connection) return;

    if (!connection.response.writableEnded) {
      connection.response.end();
    }

    this.sseConnections.delete(conversationId);
  }

  sendToConversation(conversationId: string, event: AgentEvent) {
    const response = this.sseConnections.get(conversationId)?.response;

    if (!response?.writable) {
      this.closeSSEConnection(conversationId);
      this.logger.warn(
        `SSE connection for conversation ${conversationId} is not writable`,
      );
      return;
    }

    response.write(`data: ${JSON.stringify(event)}\n\n`);
    response.flush();
  }
}
