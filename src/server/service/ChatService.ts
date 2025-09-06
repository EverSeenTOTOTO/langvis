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
    });

    const connection: SSEConnection = {
      conversationId,
      response,
      createdAt: new Date(),
    };

    this.sseConnections.set(conversationId, connection);

    response.write(
      `data: ${JSON.stringify({ type: 'heartbeat' } as SSEMessage)}\n\n`,
    );
    // flush is required with compresss middleware
    response.flush();

    // Setup heartbeat
    const heartbeat = setInterval(() => {
      if (response.writable) {
        response.write(
          `data: ${JSON.stringify({ type: 'heartbeat' } as SSEMessage)}\n\n`,
        );
        response.flush();
      }
    }, 10000); // Every 10 seconds

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

  sendToConversation(conversationId: string, msg: SSEMessage) {
    this.sseConnections
      .get(conversationId)
      ?.response.write(`data: ${JSON.stringify(msg)}\n\n`);
  }
}
