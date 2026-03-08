import {
  AddMessageToConversationRequestDto,
  BatchDeleteMessagesInConversationRequestDto,
  CreateConversationRequestDto,
  UpdateConversationRequestDto,
} from '@/shared/dto/controller';
import type { Request, Response } from 'express';
import { inject } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { body, param, request, response } from '../decorator/param';
import { ConversationService } from '../service/ConversationService';

@controller('/api/conversation')
export default class ConversationController {
  constructor(
    @inject(ConversationService)
    private conversationService: ConversationService,
  ) {}

  @api('/', { method: 'post' })
  async createConversation(
    @body() dto: CreateConversationRequestDto,
    @request() req: Request,
    @response() res: Response,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const conversation = await this.conversationService.createConversation(
      dto.name,
      userId,
      dto.config,
      dto.groupId,
      dto.groupName,
    );

    return res.status(201).json(conversation);
  }

  @api('/:id', { method: 'get' })
  async getConversationById(
    @param('id') id: string,
    @request() req: Request,
    @response() res: Response,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const conversation = await this.conversationService.getConversationById(
      id,
      userId,
    );

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    return res.json(conversation);
  }

  @api('/:id', { method: 'put' })
  async updateConversation(
    @param('id') id: string,
    @body() dto: UpdateConversationRequestDto,
    @request() req: Request,
    @response() res: Response,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const conversation = await this.conversationService.updateConversation(
      id,
      dto.name,
      userId,
      dto.config,
      dto.groupId,
      dto.groupName,
    );

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    return res.json(conversation);
  }

  @api('/:id', { method: 'delete' })
  async deleteConversation(
    @param('id') id: string,
    @request() req: Request,
    @response() res: Response,
  ) {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const result = await this.conversationService.deleteConversation(
      id,
      userId,
    );

    if (!result) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    return res.status(200).json({ success: true });
  }

  @api('/:id/messages', { method: 'post' })
  async addMessageToConversation(
    @param('id') id: string,
    @body() dto: AddMessageToConversationRequestDto,
    @response() res: Response,
  ) {
    const message = await this.conversationService.batchAddMessages(id, [
      {
        role: dto.role,
        content: dto.content,
      },
    ]);

    if (!message) {
      return res.status(404).json({ error: `Conversation ${id} not found` });
    }

    return res.status(201).json(message);
  }

  @api('/:id/messages', { method: 'get' })
  async getMessagesByConversationId(
    @param('id') id: string,
    @response() res: Response,
  ) {
    const messages =
      await this.conversationService.getMessagesByConversationId(id);

    return res.json(messages);
  }

  @api('/:id/messages', { method: 'delete' })
  async batchDeleteMessagesInConversation(
    @param('id') id: string,
    @body() dto: BatchDeleteMessagesInConversationRequestDto,
    @response() res: Response,
  ) {
    const result =
      await this.conversationService.batchDeleteMessagesInConversation(
        id,
        dto.messageIds,
      );

    if (!result) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    return res.status(204).json({ id });
  }
}
