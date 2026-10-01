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
import { WorkspaceCheckpoint } from './application/service/workspace-checkpoint';

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
    private checkpoint = new WorkspaceCheckpoint(),
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
  /** rewind：恢复 workspace 到某 turn 前的 git 快照（影子 ref）。 */
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

    const conv = conversation as { workspacePath?: string | null };
    if (!conv.workspacePath) {
      throw new HttpException(
        { error: 'Conversation has no workspace to rewind' },
        400,
      );
    }

    const ok = await this.checkpoint.restore(conv.workspacePath, messageId);
    if (!ok) {
      throw new HttpException({ error: 'No checkpoint for this turn' }, 404);
    }
    return { id, messageId, restored: true };
  }

  @Get(':id/messages')
  async getMessagesByConversationId(@Param('id') id: string) {
    return this.queryBus.execute(new GetMessagesQuery(id));
  }

  /** checkpoint 列表（rewind UI 数据面）：key=assistantMessage.id → 映射 turn 的 user 消息预览。 */
  @Get(':id/checkpoints')
  async listCheckpoints(@Param('id') id: string, @Req() req: Request) {
    const userId = requireUserId(req);
    const conversation = await this.convRepo.findById(id, userId);
    if (!conversation) {
      throw new HttpException({ error: 'Conversation not found' }, 404);
    }

    const workspacePath = (conversation as { workspacePath?: string | null })
      .workspacePath;
    if (!workspacePath) return { checkpoints: [] };

    const snapshots = await this.checkpoint.list(workspacePath);
    if (snapshots.length === 0) return { checkpoints: [] };

    const messages = await this.messageRepo.findByConversationId(id);
    const order = new Map(messages.map((m, i) => [m.id, i]));
    const checkpoints = snapshots
      .flatMap(({ key }) => {
        const idx = order.get(key);
        if (idx === undefined) return [];
        let userPreview = '';
        for (let i = idx - 1; i >= 0; i--) {
          if (messages[i].role === Role.USER) {
            userPreview = messages[i].content;
            break;
          }
        }
        return [
          {
            messageId: key,
            createdAt: new Date(messages[idx].createdAt).toISOString(),
            userPreview: userPreview.slice(0, 120),
          },
        ];
      })
      .sort((a, b) => order.get(b.messageId)! - order.get(a.messageId)!);
    return { checkpoints };
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
