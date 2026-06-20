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
import { AGENT_RUN_REPOSITORY } from '../modules/agent/agent.di-tokens';
import { CommandBus } from '@/server/libs/ddd';
import { ConversationUpdateCommand } from '../modules/conversation/contracts';
import type { AgentRunRepositoryPort } from '../modules/agent/domain/port/agent-run.repository.port';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import { Role } from '@/shared/entities/Message';
import { estimateTokens } from '../utils/estimateTokens';
import { projectRun } from '../modules/agent/domain/projection/run-projection';

@controller('/api/conversation')
export default class ConversationController {
  constructor(
    @inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
    @inject(MESSAGE_REPOSITORY)
    private messageRepo: MessageRepositoryPort,
    @inject(AGENT_RUN_REPOSITORY)
    private agentRunRepo: AgentRunRepositoryPort,
    @inject(ProviderService)
    private providerService: ProviderService,
    @inject(CommandBus)
    private commandBus: CommandBus,
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

    const conversation = await this.convRepo.create(
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
    const messages = await this.messageRepo.findByConversationId(id);

    // Merge agent_runs data for assistant messages (BC composition):
    // 事件流是事实源，projectRun 派生出 steps/status（+ content fallback）
    const agentRunIds = messages
      .filter(m => m.role === Role.ASSIST && m.agentRunId)
      .map(m => m.agentRunId!);

    const agentRuns =
      agentRunIds.length > 0
        ? await this.agentRunRepo.findByIds(agentRunIds)
        : [];
    const runMap = new Map(agentRuns.map(r => [r.id, r]));

    const enriched = messages.map(msg => {
      if (msg.role === Role.ASSIST && msg.agentRunId) {
        const run = runMap.get(msg.agentRunId);
        if (run) {
          const view = projectRun(run.events ?? []);
          return {
            ...msg,
            content: msg.content || view.content,
            steps: view.steps,
            status: run.status,
          };
        }
        return { ...msg, steps: null, status: null };
      }
      return msg;
    });

    // Calculate context usage for historical conversations
    let contextUsage: { used: number; total: number } | null = null;
    const conversation = await this.convRepo.findById(id);
    const modelId = conversation?.config?.model?.modelId;
    const model = modelId ? this.providerService.getModel(modelId) : undefined;

    if (model?.contextSize && messages.length > 0) {
      const used = estimateTokens(messages, modelId);
      contextUsage = { used, total: model.contextSize };
    }

    return res.json({ messages: enriched, contextUsage });
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
