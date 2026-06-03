import { inject } from 'tsyringe';
import { Role } from '@/shared/entities/Message';
import { commandHandler, queryHandler } from '@/server/decorator/handler';
import { EventBus, createDomainEvent } from '@/server/libs/ddd';
import { ConversationService } from './application/conversation.service';
import { CONVERSATION_REPOSITORY } from './conversation.di-tokens';
import type { ConversationRepositoryPort } from './database/conversation.repository.port';
import { AgentService } from '@/server/modules/agent/application/agent.service';
import { RedisService } from '@/server/libs/infrastructure/redis.service';
import { RedisKeys } from '@/shared/constants';
import type { ChatSessionState } from './session-manager';
import {
  ConversationActivateCommand,
  StartChatCommand,
  GetSessionStateQuery,
  ChatStarted,
  ConversationActivated,
  extractBinding,
} from './contracts';
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

// ── StartChat ─────────────────────────────────────────────

@commandHandler(StartChatCommand)
export class StartChatHandler {
  constructor(
    @inject(ConversationService)
    private convService: ConversationService,
    @inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
    @inject(EventBus)
    private eventBus: EventBus,
  ) {}

  async execute(command: StartChatCommand): Promise<{ assistantId: string }> {
    const { conversationId, userMessage, assistantId } = command;

    const setup = await this.convService.appendMessage({
      conversationId,
      userMessage,
      assistantId,
    });

    const systemMessage = setup.existingMessages.find(
      m => m.role === Role.SYSTEM,
    );
    const systemPrompt = systemMessage?.content ?? '';

    const dbConversation = await this.convRepo.findById(conversationId);
    const binding = extractBinding(dbConversation!);

    this.eventBus.emit(
      ChatStarted,
      createDomainEvent(ChatStarted, conversationId, {
        conversationId,
        assistantMessage: setup.assistantMessage,
        agentBinding: binding,
        systemPrompt,
      }),
    );

    return { assistantId: setup.assistantId };
  }
}

// ── GetSessionState ───────────────────────────────────────

@queryHandler(GetSessionStateQuery)
export class GetSessionStateHandler {
  constructor(@inject(RedisService) private redisService: RedisService) {}

  async execute(query: GetSessionStateQuery): Promise<ChatSessionState | null> {
    return this.redisService.get<ChatSessionState>(
      RedisKeys.CHAT_SESSION(query.conversationId),
    );
  }
}
