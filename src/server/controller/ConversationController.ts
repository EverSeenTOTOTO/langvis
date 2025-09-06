import type { Request, Response } from 'express';
import { inject, singleton } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { ConversationService } from '../service/ConversationService';
import { Role } from '@/shared/entities/Message';

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

    try {
      const conversation =
        await this.conversationService.createConversation(name);
      return res.status(201).json(conversation);
    } catch (e) {
      return res.status(500).json({
        error: `Failed to create conversation: ${(e as Error)?.message}`,
      });
    }
  }

  @api('/', { method: 'get' })
  async getAllConversations(_req: Request, res: Response) {
    try {
      const conversations =
        await this.conversationService.getAllConversations();
      return res.json(conversations);
    } catch (e) {
      return res.status(500).json({
        error: `Failed to fetch conversations: ${(e as Error)?.message}`,
      });
    }
  }

  @api('/:id', { method: 'get' })
  async getConversationById(req: Request, res: Response) {
    const { id } = req.params;
    try {
      const conversation =
        await this.conversationService.getConversationById(id);
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      return res.json(conversation);
    } catch (e) {
      return res.status(500).json({
        error: `Failed to fetch conversation: ${(e as Error)?.message}`,
      });
    }
  }

  @api('/:id', { method: 'put' })
  async updateConversation(req: Request, res: Response) {
    const { id } = req.params;
    const { name } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    try {
      const conversation = await this.conversationService.updateConversation(
        id,
        name,
      );
      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      return res.json(conversation);
    } catch (e) {
      return res.status(500).json({
        error: `Failed to update conversation:${(e as Error)?.message}`,
      });
    }
  }

  @api('/:id', { method: 'delete' })
  async deleteConversation(req: Request, res: Response) {
    const { id } = req.params;
    try {
      const result = await this.conversationService.deleteConversation(id);
      if (!result) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      return res.status(200).json({ success: true });
    } catch (e) {
      return res.status(500).json({
        error: `Failed to delete conversation: ${(e as Error)?.message}`,
      });
    }
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

    try {
      const message = await this.conversationService.addMessageToConversation(
        id,
        role as Role,
        content,
      );
      if (!message) {
        return res.status(404).json({ error: 'Conversation not found' });
      }
      return res.status(201).json(message);
    } catch (e) {
      return res.status(500).json({
        error: `Failed to add message to conversation: ${(e as Error)?.message}`,
      });
    }
  }

  @api('/:id/messages', { method: 'get' })
  async getMessagesByConversationId(req: Request, res: Response) {
    const { id } = req.params;
    try {
      const messages =
        await this.conversationService.getMessagesByConversationId(id);
      return res.json(messages);
    } catch (e) {
      return res.status(500).json({
        error: `Failed to fetch messages: ${(e as Error)?.message}`,
      });
    }
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
    try {
      const result =
        await this.conversationService.batchDeleteMessagesInConversation(
          id,
          messageIds,
        );
      if (!result) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      return res.status(204).json({
        id,
      });
    } catch (e) {
      return res.status(500).json({
        error: `Failed to delete messages: ${(e as Error)?.message}`,
      });
    }
  }
}
