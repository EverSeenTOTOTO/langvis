import { inject } from 'tsyringe';
import { Role } from '@/shared/entities/Message';
import {
  commandHandler,
  eventHandler,
  queryHandler,
} from '@/server/decorator/handler';
import { EventBus, createDomainEvent } from '@/server/libs/ddd';
import type { DomainEvent } from '@/server/libs/ddd';
import { ConversationService } from './application/conversation.service';
import { CONVERSATION_REPOSITORY } from './conversation.di-tokens';
import type { ConversationRepositoryPort } from './database/conversation.repository.port';
import { AgentService } from '@/server/modules/agent/application/agent.service';
import { RedisService } from '@/server/libs/infrastructure/redis.service';
import { RedisKeys } from '@/shared/constants';
import type { ChatState } from './application/conversation.service';
import {
  ConversationActivateCommand,
  CancelChatCommand,
  StartChatCommand,
  GetSessionStateQuery,
  TurnInitiated,
  RunCompleted,
  ConversationActivated,
  extractBinding,
} from './contracts';
import type { RunCompletedPayload } from './contracts';
import { ConversationNotFoundError } from './domain/conversation.errors';

// ── ConversationActivate ──────────────────────────────────

@commandHandler(ConversationActivateCommand)
export class ConversationActivateHandler {
  constructor(
    @inject(ConversationService)
    private convService: ConversationService,
    @inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
    @inject(AgentService)
    private agentService: AgentService,
    @inject(EventBus)
    private eventBus: EventBus,
  ) {}

  async execute(command: ConversationActivateCommand): Promise<void> {
    const { conversationId, userId } = command;
    const dbConversation = await this.convRepo.findById(conversationId);
    if (!dbConversation) {
      throw new ConversationNotFoundError(conversationId);
    }

    const binding = extractBinding(dbConversation);
    const systemPrompt = this.agentService.buildSystemPrompt(binding.agentId);

    await this.convService.activate({
      conversationId,
      userId,
      systemPrompt,
    });

    this.eventBus.emit(
      ConversationActivated,
      createDomainEvent(ConversationActivated, conversationId, {
        conversationId,
        agentBinding: binding,
      }),
    );
  }
}

// ── CancelChat ─────────────────────────────────────────────

@commandHandler(CancelChatCommand)
export class CancelChatHandler {
  constructor(
    @inject(ConversationService)
    private service: ConversationService,
  ) {}

  async execute(command: CancelChatCommand): Promise<void> {
    this.service.requestCancellation(
      command.conversationId,
      command.messageId,
      command.reason,
    );
  }
}

// ── StartChat ─────────────────────────────────────────────

@commandHandler(StartChatCommand)
export class StartChatHandler {
  constructor(
    @inject(ConversationService)
    private convService: ConversationService,
    @inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
    @inject(AgentService)
    private agentService: AgentService,
    @inject(EventBus)
    private eventBus: EventBus,
  ) {}

  async execute(command: StartChatCommand): Promise<{ assistantId: string }> {
    const { conversationId, userMessage, assistantId } = command;

    // 确保激活（幂等 — 消息已存在则跳过）
    const dbConversation = await this.convRepo.findById(conversationId);
    if (!dbConversation) {
      throw new ConversationNotFoundError(conversationId);
    }
    const binding = extractBinding(dbConversation);
    const systemPrompt = this.agentService.buildSystemPrompt(binding.agentId);

    await this.convService.activate({
      conversationId,
      userId: dbConversation.userId,
      systemPrompt,
    });

    const setup = await this.convService.appendMessage({
      conversationId,
      userMessage,
      assistantId,
    });

    this.convService.startTurn(conversationId, setup.assistantMessage.id);

    const systemMessage = setup.existingMessages.find(
      m => m.role === Role.SYSTEM,
    );
    const resolvedSystemPrompt = systemMessage?.content ?? systemPrompt;

    this.eventBus.emit(
      TurnInitiated,
      createDomainEvent(TurnInitiated, conversationId, {
        conversationId,
        assistantMessage: setup.assistantMessage,
        agentBinding: binding,
        systemPrompt: resolvedSystemPrompt,
      }),
    );

    return { assistantId: setup.assistantId };
  }
}

// ── GetSessionState ───────────────────────────────────────

@queryHandler(GetSessionStateQuery)
export class GetSessionStateHandler {
  constructor(@inject(RedisService) private redisService: RedisService) {}

  async execute(query: GetSessionStateQuery): Promise<ChatState | null> {
    return this.redisService.get<ChatState>(
      RedisKeys.CHAT_SESSION(query.conversationId),
    );
  }
}

// ── CompleteTurn ───────────────────────────────────────────

@eventHandler(RunCompleted)
export class CompleteTurnHandler {
  constructor(
    @inject(ConversationService)
    private convService: ConversationService,
  ) {}

  async handle(event: DomainEvent<string, RunCompletedPayload>): Promise<void> {
    const { conversationId, messageId, agentRunId } = event.payload;
    await this.convService.persistPendingMessage(
      conversationId,
      messageId,
      agentRunId,
    );
    this.convService.completeTurn(conversationId, messageId);
    this.convService.finalizeRun(conversationId, messageId);
  }
}
