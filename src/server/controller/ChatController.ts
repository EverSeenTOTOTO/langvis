import {
  CancelChatRequestDto,
  StartChatRequestDto,
} from '@/shared/dto/controller';
import type { Request, Response } from 'express';
import { inject } from 'tsyringe';
import { SSEServerTransport } from '@/server/libs/infrastructure/transport';
import { TraceContext } from '@/server/middleware/trace-context';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { body, param, request, response } from '../decorator/param';
import { AuthService } from '@/server/libs/infrastructure/auth.service';
import { CONVERSATION_REPOSITORY } from '../modules/conversation/conversation.di-tokens';
import type { ConversationRepositoryPort } from '../modules/conversation/database/conversation.repository.port';
import { ConversationService } from '../modules/conversation/application/conversation.service';
import { CommandBus, QueryBus } from '@/server/libs/ddd';
import {
  ConversationActivateCommand,
  StartChatCommand,
  GetSessionStateQuery,
} from '../modules/conversation/contracts';

@controller('/api/chat')
export default class ChatController {
  constructor(
    @inject(CommandBus)
    private commandBus: CommandBus,
    @inject(QueryBus)
    private queryBus: QueryBus,
    @inject(ConversationService)
    private conversationService: ConversationService,
    @inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
    @inject(AuthService)
    private authService: AuthService,
  ) {}

  @api('/activate/:conversationId', { method: 'post' })
  async activate(
    @param('conversationId') conversationId: string,
    @request() req: Request,
    @response() res: Response,
  ) {
    const userId = await this.authService.getUserId(req);
    const dbConv = await this.convRepo.findById(conversationId);
    if (!dbConv) {
      return res
        .status(404)
        .json({ error: `Conversation ${conversationId} not found` });
    }

    if (userId !== dbConv.userId) {
      return res.status(401).json({
        error: `Mismatched conversation user: ${userId}`,
      });
    }

    await this.commandBus.execute(
      new ConversationActivateCommand(conversationId, userId),
    );

    return res.status(200).json({ success: true });
  }

  @api('/sse/:conversationId', { method: 'get' })
  async initSSE(
    @param('conversationId') conversationId: string,
    @request() req: Request,
    @response() res: Response,
  ) {
    const conversation =
      await this.conversationService.acquireChat(conversationId);
    if (!conversation) {
      return res.sendStatus(204);
    }

    const transport = new SSEServerTransport(req, res);

    transport.addEventListener('disconnect', () => {
      req.log.info('SSE connection closed:', conversationId);
    });

    transport.addEventListener('error', (e: CustomEvent<string>) => {
      req.log.error('SSE connection error:', e.detail);
    });

    this.conversationService.attachTransport(conversationId, transport, () =>
      this.conversationService.disposeChat(conversationId),
    );

    req.log.info('SSE connection established', {
      sessionId: conversationId,
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
    const conversation = this.conversationService.getChat(conversationId);

    if (
      !conversation ||
      (conversation.phase !== 'active' && conversation.phase !== 'waiting')
    ) {
      return res.status(404).json({
        error: `No active session for conversation ${conversationId}`,
      });
    }

    this.conversationService.cancelAll(
      conversationId,
      dto.reason ?? 'Cancelled by user',
    );

    req.log.info(
      `Cancelled streaming for conversation ${conversationId}, message ${dto.messageId}`,
    );

    return res.status(200).json({ success: true });
  }

  @api('/cancel/:conversationId/:messageId', { method: 'post' })
  async cancelMessage(
    @param('conversationId') conversationId: string,
    @param('messageId') messageId: string,
    @body() dto: { reason?: string },
    @request() req: Request,
    @response() res: Response,
  ) {
    const conversation = this.conversationService.getChat(conversationId);

    if (!conversation) {
      return res.status(404).json({
        error: `No session for conversation ${conversationId}`,
      });
    }

    if (!conversation.hasActiveMessage(messageId)) {
      return res.status(404).json({
        error: `No active message ${messageId}`,
      });
    }

    this.conversationService.cancelRun(
      conversationId,
      messageId,
      dto.reason ?? 'Cancelled by user',
    );

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
    const userId = await this.authService.getUserId(req);
    TraceContext.update({ userId });

    const { assistantId } = await this.commandBus.execute(
      new StartChatCommand(conversationId, {
        role: dto.role,
        content: dto.content,
        attachments: dto.attachments,
      }),
    );

    return res.status(200).json({ success: true, messageId: assistantId });
  }

  @api('/session/:conversationId')
  async getSessionState(
    @param('conversationId') conversationId: string,
    @response() res: Response,
  ) {
    const state = await this.queryBus.execute(
      new GetSessionStateQuery(conversationId),
    );

    return res.status(200).json(state ? { phase: state.phase } : null);
  }
}
