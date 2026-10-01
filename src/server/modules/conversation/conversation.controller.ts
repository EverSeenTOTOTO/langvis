import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { Role } from '@/shared/entities/Message';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import {
  MESSAGE_REPOSITORY,
  CONVERSATION_REPOSITORY,
} from './conversation.di-tokens';
import type { MessageRepositoryPort } from './domain/port/message.repository.port';
import type { ConversationRepositoryPort } from './domain/port/conversation.repository.port';
import {
  ConversationUpdateCommand,
  CreateConversationCommand,
  GetConversationsByWorkspaceQuery,
  GetMessagesQuery,
} from './contracts';
import { SessionManager } from './application/service/session-manager';

const requireUserId = (req: Request): string => {
  const userId = req.user?.id;
  if (!userId) {
    throw new HttpException({ error: 'Unauthorized' }, 401);
  }
  return userId;
};

@Controller('conversation')
export class ConversationController {
  constructor(
    @Inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
    @Inject(MESSAGE_REPOSITORY)
    private messageRepo: MessageRepositoryPort,
    @Inject(CommandBus) private commandBus: CommandBus,
    @Inject(QueryBus) private queryBus: QueryBus,
    @Inject(SessionManager) private sessionManager: SessionManager,
  ) {}

  @Post()
  async createConversation(
    @Body()
    dto: {
      name: string;
      config?: Record<string, unknown> | null;
      groupId?: string | null;
      groupName?: string;
      workspacePath?: string | null;
    },
    @Req() req: Request,
  ) {
    const userId = requireUserId(req);
    return this.commandBus.execute(
      new CreateConversationCommand(
        dto.name,
        userId,
        dto.config,
        dto.groupId,
        dto.groupName,
        dto.workspacePath,
      ),
    );
  }

  @Get('workspace')
  async listByWorkspace(
    @Query() dto: { workspacePath: string },
    @Req() req: Request,
  ) {
    const userId = requireUserId(req);
    const conversations = await this.queryBus.execute(
      new GetConversationsByWorkspaceQuery(dto.workspacePath, userId),
    );
    return { conversations };
  }

  @Get(':id')
  async getConversationById(@Param('id') id: string, @Req() req: Request) {
    const userId = requireUserId(req);
    const conversation = await this.convRepo.findById(id, userId);
    if (!conversation) {
      throw new HttpException({ error: 'Conversation not found' }, 404);
    }
    return conversation;
  }

  @Put(':id')
  async updateConversation(
    @Param('id') id: string,
    @Body()
    dto: {
      name: string;
      config?: Record<string, unknown> | null;
      groupId?: string | null;
      groupName?: string;
    },
    @Req() req: Request,
  ) {
    const userId = requireUserId(req);
    // Existence/ownership (→ 404) + agent immutability (→ 409) validated in handler.
    return this.commandBus.execute(
      new ConversationUpdateCommand(
        id,
        userId,
        dto.name,
        dto.config,
        dto.groupId,
        dto.groupName,
      ),
    );
  }

  @Delete(':id')
  async deleteConversation(@Param('id') id: string, @Req() req: Request) {
    const userId = requireUserId(req);
    const result = await this.convRepo.delete(id, userId);
    if (!result) {
      throw new HttpException({ error: 'Conversation not found' }, 404);
    }
    return { success: true };
  }

  @Post(':id/messages')
  async addMessageToConversation(
    @Param('id') id: string,
    @Body() dto: { role: Role; content: string },
  ) {
    const message = await this.messageRepo.batchCreate(id, [
      {
        role: dto.role,
        content: dto.content,
      },
    ]);
    if (!message) {
      throw new HttpException({ error: `Conversation ${id} not found` }, 404);
    }
    return message;
  }

  // steps/status 读模型组装在 GetMessagesHandler；controller 只做 HTTP 适配。
  /** rewind：截断该 user 消息起的会话（纯对话回退，不动文件——文件交给 git）。 */
  @Post(':id/rewind/:messageId')
  async rewind(
    @Req() req: Request,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ) {
    const userId = requireUserId(req);
    const conversation = await this.convRepo.findById(id, userId);
    if (!conversation) {
      throw new HttpException({ error: 'Conversation not found' }, 404);
    }

    if (this.sessionManager.hasActiveRuns(id)) {
      throw new HttpException(
        { error: 'Run in flight — wait or cancel before rewinding' },
        409,
      );
    }

    const messages = await this.messageRepo.findByConversationId(id);
    const idx = messages.findIndex(
      m => m.id === messageId && m.role === Role.USER,
    );
    if (idx === -1) {
      throw new HttpException({ error: 'No such turn' }, 404);
    }
    const doomed = messages.slice(idx).map(m => m.id);
    await this.messageRepo.batchDeleteInConversation(id, doomed);

    // 逐出内存会话——下一 turn 从 DB 重建上下文；后台 bash 任务一并清理
    this.sessionManager.disposeChat(id);

    return { id, messageId, restored: true, deletedMessages: doomed.length };
  }

  @Get(':id/messages')
  async getMessagesByConversationId(@Param('id') id: string) {
    return this.queryBus.execute(new GetMessagesQuery(id));
  }

  /** rewind 点列表：全部 user 消息（turn 锚点），新到旧。 */
  @Get(':id/turns')
  async listTurns(@Param('id') id: string, @Req() req: Request) {
    const userId = requireUserId(req);
    const conversation = await this.convRepo.findById(id, userId);
    if (!conversation) {
      throw new HttpException({ error: 'Conversation not found' }, 404);
    }

    const messages = await this.messageRepo.findByConversationId(id);
    // meta.kind 标脚手架（session-context/compact），非对话 turn——与 groupIntoTurns 同约定
    const turns = messages
      .filter(m => m.role === Role.USER && !m.meta?.kind)
      .map(m => ({
        messageId: m.id,
        createdAt: new Date(m.createdAt).toISOString(),
        userPreview: m.content.slice(0, 120),
      }))
      .reverse();
    return { turns };
  }

  @Delete(':id/messages')
  @HttpCode(204)
  async batchDeleteMessagesInConversation(
    @Param('id') id: string,
    @Body() dto: { messageIds: string[] },
  ) {
    await this.messageRepo.batchDeleteInConversation(id, dto.messageIds);
    return { id };
  }
}
