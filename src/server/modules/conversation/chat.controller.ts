import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { SSEServerTransport } from '@/server/modules/conversation/infrastructure/transport';
import { AuthService } from '@/server/modules/user/infrastructure/auth.service';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  CancelChatRequestDto,
  StartChatRequestDto,
} from '@/shared/dto/controller';
import {
  CancelChatCommand,
  ConversationActivateCommand,
  GetSessionStateQuery,
  StartChatCommand,
  TruncateConversationCommand,
} from './contracts';

@Controller('chat')
export class ChatController {
  constructor(
    @Inject(CommandBus) private commandBus: CommandBus,
    @Inject(QueryBus) private queryBus: QueryBus,
    @Inject(AuthService) private authService: AuthService,
  ) {}

  // SSE 端点：transport 在此构造（该请求的组合根）经 command 入 session；
  // 自持 res，返回值语义不适用。
  @Get('activate/:conversationId')
  async activate(
    @Param('conversationId') conversationId: string,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const userId = await this.authService.getUserId(req.headers.cookie ?? '');
    await this.commandBus.execute(
      new ConversationActivateCommand(
        conversationId,
        userId,
        new SSEServerTransport(req, res),
      ),
    );
    req.log.info('SSE session established', {
      sessionId: conversationId,
      userId,
    });
  }

  @Post('cancel/:conversationId')
  async cancelChat(
    @Param('conversationId') conversationId: string,
    @Body() dto: CancelChatRequestDto,
    @Req() req: Request,
  ) {
    // Session existence validated in handler (→ 404).
    await this.commandBus.execute(
      new CancelChatCommand(
        conversationId,
        undefined,
        dto.reason ?? 'Cancelled by user',
      ),
    );
    req.log.info(`Cancelled streaming for conversation ${conversationId}`);
    return { success: true };
  }

  @Post('cancel/:conversationId/:messageId')
  async cancelMessage(
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Body() dto: { reason?: string },
  ) {
    // Active-run existence validated in handler (→ 404).
    await this.commandBus.execute(
      new CancelChatCommand(
        conversationId,
        messageId,
        dto.reason ?? 'Cancelled by user',
      ),
    );
    return { success: true };
  }

  @Post('start/:conversationId')
  async chat(
    @Param('conversationId') conversationId: string,
    @Body() dto: StartChatRequestDto,
    @Req() req: Request,
  ) {
    const userId = await this.authService.getUserId(req.headers.cookie ?? '');
    const { assistantId } = await this.commandBus.execute(
      new StartChatCommand(
        conversationId,
        {
          role: dto.role,
          content: dto.content,
          attachments: dto.attachments,
        },
        userId,
      ),
    );
    return { success: true, messageId: assistantId };
  }

  @Post('truncate/:conversationId/:messageId')
  async truncate(
    @Param('conversationId') conversationId: string,
    @Param('messageId') messageId: string,
    @Req() req: Request,
  ) {
    const userId = await this.authService.getUserId(req.headers.cookie ?? '');
    await this.commandBus.execute(
      new TruncateConversationCommand(conversationId, messageId, userId),
    );
    req.log.info(
      `Truncated conversation ${conversationId} before ${messageId}`,
    );
    return { success: true };
  }

  // 客户端只关心 null/非 null（会话是否存活）
  @Get('session/:conversationId')
  async getSessionState(@Param('conversationId') conversationId: string) {
    const state = await this.queryBus.execute(
      new GetSessionStateQuery(conversationId),
    );
    return state ? { active: true } : null;
  }
}
