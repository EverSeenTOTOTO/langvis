import { Role } from '@/shared/entities/Message';
import type { Request, Response } from 'express';
import { inject, singleton } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { ConversationService } from '../service/ConversationService';

@singleton()
@controller('/api/conversations')
export class ConversationController {
  constructor(
    @inject(ConversationService)
    private conversationService: ConversationService,
  ) {}

  @api('/', { method: 'post' })
  async createConversation(req: Request, res: Response) {
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const conversation =
      await this.conversationService.createConversation(name);

    return res.status(201).json(conversation);
  }

  @api('/', { method: 'get' })
  async getAllConversations(_req: Request, res: Response) {
    const conversations = await this.conversationService.getAllConversations();

    return res.json(conversations);
  }

  @api('/:id', { method: 'get' })
  async getConversationById(req: Request, res: Response) {
    const { id } = req.params;
    const conversation = await this.conversationService.getConversationById(id);

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    return res.json(conversation);
  }

  @api('/:id', { method: 'put' })
  async updateConversation(req: Request, res: Response) {
    const { id } = req.params;
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const conversation = await this.conversationService.updateConversation(
      id,
      name,
    );

    if (!conversation) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    return res.json(conversation);
  }

  @api('/:id', { method: 'delete' })
  async deleteConversation(req: Request, res: Response) {
    const { id } = req.params;

    const result = await this.conversationService.deleteConversation(id);

    if (!result) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    return res.status(200).json({ success: true });
  }

  @api('/:id/messages', { method: 'post' })
  async addMessageToConversation(req: Request, res: Response) {
    const { id } = req.params;
    const { role, content } = req.body;

    if (!role || !content) {
      return res.status(400).json({ error: 'Role and content are required' });
    }

    // Validate role
    if (!Object.values(Role).includes(role as Role)) {
      return res.status(400).json({ error: 'Invalid role' });
    }

    const message = await this.conversationService.addMessageToConversation(
      id,
      role as Role,
      content,
    );

    if (!message) {
      return res.status(404).json({ error: `Conversation ${id} not found` });
    }

    return res.status(201).json(message);
  }

  @api('/:id/messages', { method: 'get' })
  async getMessagesByConversationId(req: Request, res: Response) {
    const { id } = req.params;
    const messages =
      await this.conversationService.getMessagesByConversationId(id);

    return res.json(messages);
  }

  @api('/:id/messages', { method: 'delete' })
  async batchDeleteMessagesInConversation(req: Request, res: Response) {
    const { id } = req.params;
    const { messageIds } = req.body;
    if (!Array.isArray(messageIds) || messageIds.length === 0) {
      return res
        .status(400)
        .json({ error: 'messageIds must be a non-empty array' });
    }

    const result =
      await this.conversationService.batchDeleteMessagesInConversation(
        id,
        messageIds,
      );

    if (!result) {
      return res.status(404).json({ error: 'Conversation not found' });
    }

    return res.status(204).json({ id });
  }
}
