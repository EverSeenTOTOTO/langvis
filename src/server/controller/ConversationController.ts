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
import {
  MESSAGE_REPOSITORY,
  CONVERSATION_REPOSITORY,
} from '../modules/conversation/conversation.di-tokens';
import type { MessageRepositoryPort } from '../modules/conversation/domain/port/message.repository.port';
import type { ConversationRepositoryPort } from '../modules/conversation/domain/port/conversation.repository.port';
import { CommandBus, QueryBus } from '@/server/libs/ddd';
import {
  ConversationUpdateCommand,
  CreateConversationCommand,
  GetMessagesQuery,
} from '../modules/conversation/contracts';

@controller('/api/conversation')
export default class ConversationController {
  constructor(
    @inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
    @inject(MESSAGE_REPOSITORY)
    private messageRepo: MessageRepositoryPort,
    @inject(CommandBus)
    private commandBus: CommandBus,
    @inject(QueryBus)
    private queryBus: QueryBus,
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

    const conversation = await this.commandBus.execute(
      new CreateConversationCommand(
        dto.name,
        userId,
        dto.config,
        dto.groupId,
        dto.groupName,
      ),
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

    const conversation = await this.convRepo.findById(id, userId);

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

    // Existence/ownership (→ 404) + agent immutability (→ 409) validated in handler.
    const conversation = await this.commandBus.execute(
      new ConversationUpdateCommand(
        id,
        userId,
        dto.name,
        dto.config,
        dto.groupId,
        dto.groupName,
      ),
    );

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

    const result = await this.convRepo.delete(id, userId);

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
    const message = await this.messageRepo.batchCreate(id, [
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
    // steps/status（+ content fallback）的读模型组装在 GetMessagesHandler：
    // 事件流是事实源，projectRun 派生；controller 只做 HTTP 适配。
    const messages = await this.queryBus.execute(new GetMessagesQuery(id));
    return res.json(messages);
  }

  @api('/:id/messages', { method: 'delete' })
  async batchDeleteMessagesInConversation(
    @param('id') id: string,
    @body() dto: BatchDeleteMessagesInConversationRequestDto,
    @response() res: Response,
  ) {
    await this.messageRepo.batchDeleteInConversation(id, dto.messageIds);

    return res.status(204).json({ id });
  }
}
