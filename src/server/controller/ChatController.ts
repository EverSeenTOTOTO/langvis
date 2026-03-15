import {
  CancelChatRequestDto,
  StartChatRequestDto,
} from '@/shared/dto/controller';
import { Message, Role } from '@/shared/entities/Message';
import type { Request, Response } from 'express';
import { container, inject } from 'tsyringe';
import { PendingMessage } from '../core/PendingMessage';
import { SSEConnection } from '../core/SSEConnection';
import type { Agent } from '../core/agent';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { body, param, request, response } from '../decorator/param';
import { AuthService } from '../service/AuthService';
import { ChatService } from '../service/ChatService';
import { ConversationService } from '../service/ConversationService';

@controller('/api/chat')
export default class ChatController {
  constructor(
    @inject(ConversationService)
    private conversationService: ConversationService,
    @inject(ChatService)
    private chatService: ChatService,
    @inject(AuthService)
    private authService: AuthService,
  ) {}

  @api('/sse/:conversationId', { method: 'get' })
  async initSSE(
    @param('conversationId') conversationId: string,
    @request() req: Request,
    @response() res: Response,
  ) {
    const sessionState = await this.chatService.getSessionState(conversationId);

    if (sessionState?.phase === 'done') {
      return res.status(200).json({ type: 'session_ended', conversationId });
    }

    const session = await this.chatService.acquireSession(conversationId);
    if (!session) {
      return res.status(409).json({ error: 'Session lock contention' });
    }

    const sseConnection = new SSEConnection(conversationId, res);
    session.bindConnection(sseConnection);

    req.log.info('SSE connection established', { sessionId: conversationId });

    req.on('close', () => {
      req.log.info('SSE connection closed:', conversationId);
      session.handleDisconnect();
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

    const userId = await this.authService.getUserId(req);

    const memory = await this.chatService.buildMemory(
      agent,
      conversationId,
      userId,
      conversation.config!,
      {
        role: dto.role,
        content: dto.content,
        attachments: dto.attachments,
      },
    );

    const [assistantMessage] = await this.conversationService.batchAddMessages(
      conversation.id!,
      [{ role: Role.ASSIST, content: '', createdAt: new Date() }],
    );

    res.status(200).json({ success: true, messageId: assistantMessage.id });

    const pendingMessage = new PendingMessage(
      assistantMessage,
      (message: Message) =>
        this.conversationService.updateMessage(
          message.id,
          message.content,
          message.meta,
        ),
    );
    session.bindPendingMessage(pendingMessage);

    this.chatService.runSession(session, agent, memory, conversation.config);

    return;
  }

  @api('/session/:conversationId')
  async getSessionState(
    @param('conversationId') conversationId: string,
    @response() res: Response,
  ) {
    const state = await this.chatService.getSessionState(conversationId);
    return res.status(200).json(state ? { phase: state.phase } : null);
  }
}
