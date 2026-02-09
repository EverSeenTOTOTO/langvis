import {
  CancelChatRequestDto,
  StartChatRequestDto,
} from '@/shared/dto/controller';
import { Role } from '@/shared/entities/Message';
import chalk from 'chalk';
import type { Request, Response } from 'express';
import { container, inject } from 'tsyringe';
import type { Agent } from '../core/agent';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { body, param, request, response } from '../decorator/param';
import { ChatService } from '../service/ChatService';
import { ConversationService } from '../service/ConversationService';
import { SSEService } from '../service/SSEService';

@controller('/api/chat')
export default class ChatController {
  constructor(
    @inject(SSEService)
    private sseService: SSEService,

    @inject(ConversationService)
    private conversationService: ConversationService,

    @inject(ChatService)
    private chatService: ChatService,
  ) {}

  @api('/sse/:conversationId', { method: 'get' })
  async initSSE(
    @param('conversationId') conversationId: string,
    @request() req: Request,
    @response() res: Response,
  ) {
    this.sseService.initSSEConnection(conversationId, res);

    req.on('close', () => {
      req.log.info('SSE connection closed:', conversationId);
      this.sseService.closeSSEConnection(conversationId);
    });

    req.on('error', err => {
      const isNormalClose =
        err.message === 'aborted' || (err as any).code === 'ECONNRESET';
      if (!isNormalClose) {
        req.log.error('SSE connection error:', err);
      }
    });
  }

  @api('/cancel/:conversationId', { method: 'post' })
  async cancelChat(
    @param('conversationId') conversationId: string,
    @body() dto: CancelChatRequestDto,
    @request() req: Request,
    @response() res: Response,
  ) {
    const cancelled = await this.chatService.cancelAgent(
      conversationId,
      dto.reason,
    );

    if (!cancelled) {
      return res.status(404).json({
        error: `No active agent found for conversation ${conversationId}`,
      });
    }

    req.log.info(
      `Cancelled streaming for conversation ${conversationId}, message ${dto.messageId}`,
    );

    return res.status(200).json({ success: true });
  }

  @api('/start/:conversationId', { method: 'post' })
  async chat(
    @param('conversationId') conversationId: string,
    @body() dto: StartChatRequestDto,
    @request() req: Request,
    @response() res: Response,
  ) {
    const conversation =
      await this.conversationService.getConversationById(conversationId);

    if (!conversation) {
      return res
        .status(404)
        .json({ error: `Conversation ${conversationId} not found` });
    }

    const agent = container.resolve(conversation.config!.agent) as Agent;

    if (!agent) {
      return res.status(400).json({ error: 'Agent not found' });
    }

    const memory = await this.chatService.buildMemory(
      req,
      agent,
      conversation.config!,
      {
        role: dto.role,
        content: dto.content,
      },
    );

    const [assistantMessage] = await this.conversationService.batchAddMessages(
      conversationId,
      [
        {
          role: Role.ASSIST,
          content: '',
          meta: { loading: true },
          createdAt: new Date(),
        },
      ],
    );

    req.log.info(
      `Created loading message for conversation ${conversationId}, starting agent: ${chalk.yellow(conversation.config!.agent)}`,
    );

    // Return response first so client can fetch the loading message
    res.status(200).json({ success: true });

    // Then start agent streaming asynchronously
    const abortController = new AbortController();
    const generator = agent.call(
      memory,
      conversation.config!,
      abortController.signal,
    );

    this.chatService.consumeAgentStream(
      conversationId,
      assistantMessage,
      generator,
      abortController,
    );

    return;
  }
}
