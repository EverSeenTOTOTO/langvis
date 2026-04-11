import {
  CancelChatRequestDto,
  StartChatRequestDto,
} from '@/shared/dto/controller';
import type { Request, Response } from 'express';
import { container, inject } from 'tsyringe';
import { PendingMessage } from '../core/PendingMessage';
import type { Message } from '@/shared/types/entities';
import { Memory } from '../core/memory';
import { SSEConnection } from '../core/SSEConnection';
import { TraceContext } from '../core/TraceContext';
import type { Agent } from '../core/agent';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { body, param, request, response } from '../decorator/param';
import { AuthService } from '../service/AuthService';
import { ChatService } from '../service/ChatService';
import { ConversationService } from '../service/ConversationService';
import { MemoryIds } from '@/shared/constants';

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
    const userId = await this.authService.getUserId(req);

    if (userId !== conversation.userId) {
      return res.status(401).json({
        error: `Mismatched conversation user: ${userId}`,
      });
    }

    TraceContext.update({
      conversationId,
      userId,
    });

    // Create memory for this session
    const memory = container.resolve<Memory>(
      conversation.config?.memory?.type ?? MemoryIds.SLIDE_WINDOW,
    );
    if (conversation.config?.memory?.windowSize) {
      memory.setWindowSize(conversation.config.memory.windowSize);
    }
    session.setMemory(memory);

    // Prepare turn messages
    const { messages, assistantId, assistantMessage } =
      await this.chatService.prepareTurn({
        conversationId,
        userId: conversation.userId,
        systemPrompt: agent.systemPrompt.build(),
        userMessage: {
          role: dto.role,
          content: dto.content,
          attachments: dto.attachments,
        },
      });

    // Inject context into memory (full history including new turn)
    memory.setContext(messages);

    // Update TraceContext with messageId
    TraceContext.update({
      messageId: assistantId,
      traceId: assistantId,
    });
    TraceContext.freeze();

    res.status(200).json({ success: true, messageId: assistantId });

    // Create PendingMessage and register with persist callback
    const pendingMessage = new PendingMessage(assistantMessage);
    session.addMessageFSM(assistantId, pendingMessage, (message: Message) =>
      this.conversationService.saveMessage(message),
    );

    this.chatService.runSession(
      session,
      agent,
      conversation.config,
      assistantId,
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
