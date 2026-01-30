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
    const cancelled = await this.chatService.cancelStream(
      dto.messageId,
      dto.reason,
    );

    if (!cancelled) {
      return res.status(404).json({
        error: `No active stream found for message ${dto.messageId}`,
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

    await this.startAgent(req, conversation.config!, {
      role: dto.role,
      content: dto.content,
    });

    return res.status(200).json({ success: true });
  }

  private async startAgent(
    req: Request,
    config: Record<string, any>,
    userMessage: {
      role: Role;
      content: string;
      meta?: Record<string, any> | null;
    },
  ) {
    const { conversationId } = req.params;

    req.log.info(
      `Starting agent call for conversation ${conversationId}, agent: ${chalk.yellow(config.agent)}`,
    );

    const agent = container.resolve(config.agent) as Agent;

    if (!agent) {
      req.log.error(`Agent ${chalk.yellow(config.agent)} not registered.`);
      return;
    }

    const memory = await this.chatService.buildMemory(
      req,
      agent,
      config,
      userMessage,
    );

    // create empty assist message for streaming
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

    const writer = await this.chatService.createStreamForMessage(
      conversationId,
      assistantMessage,
    );

    agent.streamCall(memory, writer, config).catch(e => writer.abort(e));
  }
}
