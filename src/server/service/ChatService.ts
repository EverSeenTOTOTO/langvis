import { SSEMessage } from '@/shared/types';
import { singleton } from 'tsyringe';

interface SSEConnection {
  conversationId: string;
  response: any;
  createdAt: Date;
}

@singleton()
export class ChatService {
  private sseConnections: Map<string, SSEConnection> = new Map();
  private heartbeats: Map<string, NodeJS.Timeout> = new Map();

  initSSEConnection(conversationId: string, response: any) {
    response.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    response.write(
      `data: ${JSON.stringify({ type: 'connected', message: 'SSE connection established' })}\n\n`,
    );

    const connection: SSEConnection = {
      conversationId,
      response,
      createdAt: new Date(),
    };

    this.sseConnections.set(conversationId, connection);

    const heartbeat = setInterval(() => {
      if (response.writable) {
        response.write(`data: ${JSON.stringify({ type: 'heartbeat' })}\n\n`);
      }
    }, 25000);

    this.heartbeats.set(conversationId, heartbeat);

    return connection;
  }

  closeSSEConnection(conversationId: string) {
    const connection = this.sseConnections.get(conversationId);

    if (connection) {
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
  }

  sendToConversation(msg: SSEMessage) {
    this.sseConnections
      .get(msg.conversationId)
      ?.response.write(`data: ${JSON.stringify(msg)}\n\n`);
  }
}
