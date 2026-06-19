import {
  CancelChatRequestDto,
  StartChatRequestDto,
} from '@/shared/dto/controller';
import type { Request, Response } from 'express';
import { inject } from 'tsyringe';
import { SSEServerTransport } from '@/server/libs/infrastructure/transport';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { body, param, request, response } from '../decorator/param';
import { AuthService } from '@/server/libs/infrastructure/auth.service';
import { CONVERSATION_REPOSITORY } from '../modules/conversation/conversation.di-tokens';
import type { ConversationRepositoryPort } from '../modules/conversation/domain/port/conversation.repository.port';
import { SessionManager } from '../modules/conversation/application/service/session-manager';
import { CommandBus, QueryBus } from '@/server/libs/ddd';
import {
  ConversationActivateCommand,
  CancelChatCommand,
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
    @inject(SessionManager)
    private sessionManager: SessionManager,
    @inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
    @inject(AuthService)
    private authService: AuthService,
  ) {}

  @api('/activate/:conversationId', { method: 'get' })
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

    // Activate (idempotent — creates system messages if none exist)
    await this.commandBus.execute(
      new ConversationActivateCommand(conversationId, userId),
    );

    // SSE setup
    await this.sessionManager.initSession(
      conversationId,
      new SSEServerTransport(req, res),
    );

    req.log.info('SSE session established', {
      sessionId: conversationId,
      userId,
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
    if (!this.sessionManager.hasSession(conversationId)) {
      return res.status(404).json({
        error: `No active session for conversation ${conversationId}`,
      });
    }

    await this.commandBus.execute(
      new CancelChatCommand(
        conversationId,
        undefined,
        dto.reason ?? 'Cancelled by user',
      ),
    );

    req.log.info(`Cancelled streaming for conversation ${conversationId}`);

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
    if (!this.sessionManager.hasActiveRun(conversationId, messageId)) {
      return res.status(404).json({
        error: `No active message ${messageId}`,
      });
    }

    await this.commandBus.execute(
      new CancelChatCommand(
        conversationId,
        messageId,
        dto.reason ?? 'Cancelled by user',
      ),
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
    @response() res: Response,
  ) {
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

    // 客户端只关心 null/非 null（会话是否存活）
    return res.status(200).json(state ? { active: true } : null);
  }
}
