import {
  CancelChatRequestDto,
  StartChatRequestDto,
} from '@/shared/dto/controller';
import { Message, Role } from '@/shared/entities/Message';
import type { Request, Response } from 'express';
import { container, inject } from 'tsyringe';
import { PendingMessage } from '../core/PendingMessage';
import { SSEConnection } from '../core/SSEConnection';
import { TraceContext } from '../core/TraceContext';
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
    const session = await this.chatService.acquireSession(conversationId);
    if (!session) {
      return res.sendStatus(204);
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

    if (
      !session ||
      (session.phase !== 'active' && session.phase !== 'waiting')
    ) {
      return res.status(404).json({
        error: `No active session for conversation ${conversationId}`,
      });
    }

    session.cancelAllMessages(dto.reason ?? 'Cancelled by user');

    req.log.info(
      `Cancelled streaming for conversation ${conversationId}, message ${dto.messageId}`,
    );

    return res.status(200).json({ success: true });
  }

  @api('/cancel/:conversationId/:messageId', { method: 'post' })
  async cancelMessage(
    @param('conversationId') conversationId: string,
    @param('messageId') messageId: string,
    @body() _dto: { reason?: string },
    @request() req: Request,
    @response() res: Response,
  ) {
    const session = this.chatService.getSession(conversationId);

    if (!session) {
      return res.status(404).json({
        error: `No session for conversation ${conversationId}`,
      });
    }

    const messageFSM = session.getMessageFSM(messageId);
    if (!messageFSM || messageFSM.isTerminated) {
      return res.status(404).json({
        error: `No active message ${messageId}`,
      });
    }

    session.cancelMessage(messageId);

    req.log.info(
      `Cancelled message ${messageId} for conversation ${conversationId}`,
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

    if (!session) {
      return res.status(400).json({
        error: 'SSE connection not established',
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

    // Verify user is authenticated
    await this.authService.getUserId(req);

    TraceContext.update({ conversationId, userId: conversation.userId });

    const memory = await this.chatService.buildMemory(
      agent,
      conversation.config!,
      {
        role: dto.role,
        content: dto.content,
        attachments: dto.attachments,
      },
    );

    // Use a timestamp that is guaranteed to be after all previous messages
    // Add 100ms buffer to ensure correct ordering
    const [assistantMessage] = await this.conversationService.batchAddMessages(
      conversation.id!,
      [
        {
          role: Role.ASSIST,
          content: '',
          createdAt: new Date(Date.now() + 100),
        },
      ],
    );

    // Update TraceContext with messageId
    TraceContext.update({
      messageId: assistantMessage.id,
      traceId: assistantMessage.id,
    });
    TraceContext.freeze();

    res.status(200).json({ success: true, messageId: assistantMessage.id });

    // Create PendingMessage and MessageFSM
    const pendingMessage = new PendingMessage(
      assistantMessage,
      (message: Message) =>
        this.conversationService.updateMessage(
          message.id,
          message.content,
          message.meta,
        ),
    );

    session.addMessageFSM(assistantMessage.id, pendingMessage);

    this.chatService.runSession(
      session,
      agent,
      memory,
      conversation.config,
      assistantMessage.id,
    );

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
