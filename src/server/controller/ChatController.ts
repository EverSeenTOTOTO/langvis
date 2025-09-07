import { Role } from '@/shared/entities/Message';
import type { Request, Response } from 'express';
import { pick } from 'lodash-es';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { inject, singleton } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { ChatService } from '../service/ChatService';
import { CompletionService } from '../service/CompletionService';
import { ConversationService } from '../service/ConversationService';

@singleton()
@controller('/api/chat')
export class ChatController {
  constructor(
    @inject(ChatService)
    private chatService: ChatService,

    @inject(ConversationService)
    private conversationService: ConversationService,

    @inject(CompletionService)
    private completionService: CompletionService,
  ) {}

  @api('/sse/:conversationId', { method: 'get' })
  async initSSE(req: Request, res: Response) {
    const { conversationId } = req.params;

    this.chatService.initSSEConnection(conversationId, res);

    req.on('close', () => {
      this.chatService.closeSSEConnection(conversationId);
    });

    req.on('error', err => {
      req.log.error('SSE connection error:', err);
      this.chatService.closeSSEConnection(conversationId);
    });
  }

  @api('/start/:conversationId', { method: 'post' })
  async chat(req: Request, res: Response) {
    const { conversationId } = req.params;
    const { role, content } = req.body;

    if (!role || !content) {
      return res.status(400).json({ error: 'Role and content are required' });
    }

    // Validate role
    if (!Object.values(Role).includes(role as Role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const message = await this.conversationService.addMessageToConversation(
      conversationId,
      role as Role,
      content,
    );

    this.startCompletion(req);

    if (!message) {
      return res
        .status(404)
        .json({ error: `Conversation ${conversationId} not found` });
    }

    return res.status(201).json(message);
  }

  private async startCompletion(req: Request) {
    const { conversationId } = req.params;
    const messages =
      await this.conversationService.getMessagesByConversationId(
        conversationId,
      );

    try {
      const stream = await this.completionService.streamChatCompletion({
        messages: messages.map(each =>
          pick(each, ['role', 'content']),
        ) as ChatCompletionMessageParam[],
        stream: true,
      });

      for await (const chunk of stream) {
        const delta = chunk?.choices[0]?.delta?.content || '';
        const sseEvent = `data: ${delta}\n\n`;

        this.chatService.sendToConversation(conversationId, {
          type: 'reply',
          content: sseEvent,
        });
      }
    } catch (e) {
      req.log.error(e);
      this.chatService.sendToConversation(conversationId, {
        type: 'error',
        error: (e as Error)?.message,
      });
    }
  }
}
