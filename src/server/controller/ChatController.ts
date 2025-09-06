import type { Request, Response } from 'express';
import { inject, singleton } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { ChatService } from '../service/ChatService';

@singleton()
@controller('/api/chat')
export class ChatController {
  constructor(
    @inject(ChatService)
    private chatService: ChatService,
  ) {}

  @api('/sse/:conversationId', { method: 'get' })
  async initSSE(req: Request, res: Response) {
    const { conversationId } = req.params;

    try {
      this.chatService.initSSEConnection(conversationId, res);

      req.on('close', () => {
        this.chatService.closeSSEConnection(conversationId);
      });

      req.on('error', err => {
        req.log.error('SSE connection error:', err);
        this.chatService.closeSSEConnection(conversationId);
      });
    } catch (e) {
      res.status(500).json({
        error: `Failed to initialize SSE: ${(e as Error)?.message}`,
      });
    }
  }
}
