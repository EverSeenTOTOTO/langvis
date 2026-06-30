import { inject } from 'tsyringe';
import { Role } from '@/shared/entities/Message';
import { commandHandler } from '@/server/decorator/handler';
import { createDomainEvent, EventBus } from '@/server/libs/ddd';
import { ChatService } from '../service/chat.service';
import { SessionManager } from '../service/session-manager';
import { CONVERSATION_REPOSITORY } from '../../conversation.di-tokens';
import type { ConversationRepositoryPort } from '../../domain/port/conversation.repository.port';
import {
  StartChatCommand,
  TurnInitiated,
  extractUserConfig,
} from '../../contracts';
import { ConversationNotFoundError } from '../../domain/errors';

@commandHandler(StartChatCommand)
export class StartChatHandler {
  constructor(
    @inject(ChatService)
    private convService: ChatService,
    @inject(SessionManager)
    private sessionManager: SessionManager,
    @inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
    @inject(EventBus)
    private eventBus: EventBus,
  ) {}

  async execute(command: StartChatCommand): Promise<{ assistantId: string }> {
    const { conversationId, userMessage, assistantId } = command;

    const dbConversation = await this.convRepo.findById(conversationId);
    if (!dbConversation) {
      throw new ConversationNotFoundError(conversationId);
    }
    const userConfig = extractUserConfig(dbConversation);

    // 前置条件：会话必须已激活（调用方需先 activate）。不再静默激活。
    await this.convService.assertActivated(conversationId);

    const setup = await this.convService.appendMessage({
      conversationId,
      userMessage,
      assistantId,
    });

    // systemPrompt 取自激活时烘焙的 system 消息（会话自有数据）；agent 不再被回调取 prompt。
    const systemMessage = setup.existingMessages.find(
      m => m.role === Role.SYSTEM,
    );
    const systemPrompt = systemMessage?.content ?? '';

    // 增量追加本轮 user 消息到会话记忆（assistant 占位不追加——种子只到 user query），
    // 再取有效历史作为 agent run 的种子。
    const memory = this.sessionManager.getMemory(conversationId);
    memory.append(setup.userMessage);
    const effectiveHistory = await memory.buildContext();

    this.eventBus.dispatch(
      TurnInitiated,
      createDomainEvent(TurnInitiated, conversationId, {
        conversationId,
        assistantMessage: setup.assistantMessage,
        userConfig,
        systemPrompt,
        effectiveHistory,
      }),
    );

    return { assistantId: setup.assistantId };
  }
}
