import {
  CreateConversationGroupRequestDto,
  ReorderConversationsInGroupRequestDto,
  ReorderItemsRequestDto,
  UpdateConversationGroupRequestDto,
} from '@/shared/dto/controller';
import type { Request, Response } from 'express';
import { inject } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { body, param, request, response } from '../decorator/param';
import { ConversationGroupService } from '../service/ConversationGroupService';

@controller('/api/conversation-group')
export default class ConversationGroupController {
  constructor(
    @inject(ConversationGroupService)
    private conversationGroupService: ConversationGroupService,
  ) {}

  @api('/', { method: 'post' })
  async createGroup(
    @body() dto: CreateConversationGroupRequestDto,
    @request() req: Request,
    @response() res: Response,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const group = await this.conversationGroupService.createGroup(
      dto.name,
      userId,
    );
    return res.status(201).json(group);
  }

  @api('/')
  async getGroups(@request() req: Request, @response() res: Response) {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result =
      await this.conversationGroupService.getGroupsByUserId(userId);
    return res.json(result);
  }

  @api('/:id', { method: 'put' })
  async updateGroup(
    @param('id') id: string,
    @body() dto: UpdateConversationGroupRequestDto,
    @request() req: Request,
    @response() res: Response,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const group = await this.conversationGroupService.updateGroup(
      id,
      dto.name,
      userId,
    );
    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }
    return res.json(group);
  }

  @api('/:id', { method: 'delete' })
  async deleteGroup(
    @param('id') id: string,
    @request() req: Request,
    @response() res: Response,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await this.conversationGroupService.deleteGroup(id, userId);
    if (!result.success) {
      return res.status(404).json({ error: 'Group not found' });
    }
    return res.json(result);
  }

  @api('/reorder', { method: 'post' })
  async reorderGroups(
    @body() dto: ReorderItemsRequestDto,
    @request() req: Request,
    @response() res: Response,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await this.conversationGroupService.reorderGroups(dto.items, userId);
    return res.json({ success: true });
  }

  @api('/reorder-conversations', { method: 'post' })
  async reorderConversationsInGroup(
    @body() dto: ReorderConversationsInGroupRequestDto,
    @request() req: Request,
    @response() res: Response,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    await this.conversationGroupService.reorderConversationsInGroup(
      dto.groupId,
      dto.items,
      userId,
    );
    return res.json({ success: true });
  }
}
