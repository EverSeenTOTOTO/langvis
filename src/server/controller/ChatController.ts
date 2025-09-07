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
      req.log.info('SSE connection closed:', conversationId);
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

    const start = Date.now();
    req.log.info(`Starting completion for conversation ${conversationId}`);

    const stream = await this.completionService.streamChatCompletion({
      messages: (messages || []).map(each =>
        pick(each, ['role', 'content']),
      ) as ChatCompletionMessageParam[],
    });

    let content = '';
    for await (const chunk of stream) {
      if (!content) {
        req.log.info(
          `First chunk received for conversation ${conversationId}, time taken: ${Date.now() - start}ms`,
        );
      }

      const delta = chunk?.choices[0]?.delta?.content || '';

      content += delta;

      req.log.debug(JSON.stringify(chunk, null, 2));

      this.chatService.sendToConversation(conversationId, {
        type: 'completion_delta',
        content: delta,
      });

      // persist the message when finished
      if (chunk.choices[0]?.finish_reason) {
        req.log.info(
          `Received ${content.length} characters of content for conversation ${conversationId}, finish_reason: ${chunk.choices[0]?.finish_reason}.`,
        );

        await this.conversationService.addMessageToConversation(
          conversationId,
          Role.ASSIST,
          content,
        );

        this.chatService.sendToConversation(conversationId, {
          type: 'completion_done',
          finish_reaseon: chunk.choices[0]?.finish_reason,
        });
        break;
      }
    }
  }
}
