import {
  CancelChatRequestDto,
  StartChatRequestDto,
} from '@/shared/dto/controller';
import { Role } from '@/shared/entities/Message';
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
    // 1. Atomic acquire - can reject with 409 before writing HTTP headers
    const session = this.chatService.acquireSession(conversationId);
    if (!session) {
      return res.status(409).json({ error: 'Session already running' });
    }

    // 2. Initialize SSE connection (writeHead 200, cannot change status after)
    const sseConnection = this.sseService.initSSEConnection(
      conversationId,
      res,
    );

    // 3. Bind connection to session
    session.bindConnection(sseConnection);

    req.on('close', () => {
      req.log.info('SSE connection closed:', conversationId);
      session.onClientDisconnect();
    });

    req.on('error', err => {
      const isNormalClose =
        err.message === 'aborted' || (err as any).code === 'ECONNRESET';
      if (!isNormalClose) {
        req.log.error('SSE connection error:', err);
      }
    });

    return;
  }

  @api('/cancel/:conversationId', { method: 'post' })
  async cancelChat(
    @param('conversationId') conversationId: string,
    @body() dto: CancelChatRequestDto,
    @request() req: Request,
    @response() res: Response,
  ) {
    const session = this.chatService.getSession(conversationId);

    if (!session || session.phase !== 'running') {
      return res.status(404).json({
        error: `No active session for conversation ${conversationId}`,
      });
    }

    session.cancel(dto.reason ?? 'Cancelled by user');

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
    const session = this.chatService.getSession(conversationId);

    if (!session || session.phase !== 'waiting') {
      return res.status(400).json({
        error: session
          ? 'Session already running'
          : 'SSE connection not established',
      });
    }

    const conversation =
      await this.conversationService.getConversationById(conversationId);

    if (!conversation) {
      return res
        .status(400)
        .json({ error: `Conversation ${conversationId} not found` });
    }

    const agent = container.resolve(conversation.config!.agent) as Agent;

    if (!agent) {
      return res
        .status(400)
        .json({ error: `Agent ${conversation.config!.agent} not found` });
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

    // Persist assistant placeholder before HTTP response
    // User message + system prompt are already persisted by buildMemory → memory.store()
    const [assistantMessage] = await this.conversationService.batchAddMessages(
      conversation.id!,
      [{ role: Role.ASSIST, content: '', createdAt: new Date() }],
    );

    res.status(200).json({ success: true, messageId: assistantMessage.id });

    // Agent execution after HTTP response
    this.chatService.startAgent(
      session,
      conversation,
      agent,
      memory,
      assistantMessage,
    );

    return;
  }
}
