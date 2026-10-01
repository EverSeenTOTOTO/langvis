import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Inject,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CONVERSATION_REPOSITORY } from './conversation.di-tokens';
import type { ConversationRepositoryPort } from './domain/port/conversation.repository.port';

const requireUserId = (req: Request): string => {
  const userId = req.user?.id;
  if (!userId) {
    throw new HttpException({ error: 'Unauthorized' }, 401);
  }
  return userId;
};

@Controller('conversation-group')
export class ConversationGroupController {
  constructor(
    @Inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
  ) {}

  @Post()
  async createGroup(@Body() dto: { name: string }, @Req() req: Request) {
    const userId = requireUserId(req);
    return this.convRepo.createGroup(dto.name, userId);
  }

  @Get()
  async getGroups(@Req() req: Request) {
    const userId = requireUserId(req);
    return this.convRepo.findGroupsByUserId(userId);
  }

  @Put(':id')
  async updateGroup(
    @Param('id') id: string,
    @Body() dto: { name: string },
    @Req() req: Request,
  ) {
    const userId = requireUserId(req);
    const group = await this.convRepo.updateGroup(id, dto.name, userId);
    if (!group) {
      throw new HttpException({ error: 'Group not found' }, 404);
    }
    return group;
  }

  @Delete(':id')
  async deleteGroup(@Param('id') id: string, @Req() req: Request) {
    const userId = requireUserId(req);
    const result = await this.convRepo.deleteGroup(id, userId);
    if (!result.success) {
      throw new HttpException({ error: 'Group not found' }, 404);
    }
    return result;
  }

  @Post('reorder')
  async reorderGroups(
    @Body() dto: { items: { id: string; type: 'group'; order: number }[] },
    @Req() req: Request,
  ) {
    const userId = requireUserId(req);
    await this.convRepo.reorderGroups(dto.items, userId);
    return { success: true };
  }

  @Post('reorder-conversations')
  async reorderConversationsInGroup(
    @Body()
    dto: {
      groupId: string;
      items: { id: string; type: 'group'; order: number }[];
    },
    @Req() req: Request,
  ) {
    const userId = requireUserId(req);
    await this.convRepo.reorderConversationsInGroup(
      dto.groupId,
      dto.items,
      userId,
    );
    return { success: true };
  }
}
