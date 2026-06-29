import { inject } from 'tsyringe';
import { commandHandler } from '@/server/decorator/handler';
import { EventBus, createDomainEvent } from '@/server/libs/ddd';
import { ChatService } from '../service/chat.service';
import { AgentService } from '@/server/modules/agent/application/service/agent.service';
import { CONVERSATION_REPOSITORY } from '../../conversation.di-tokens';
import type { ConversationRepositoryPort } from '../../domain/port/conversation.repository.port';
import { CONVERSATION_MEMORY_PORT } from '@/server/modules/memory';
import type { ConversationMemoryPort } from '@/server/modules/memory';
import {
  ConversationActivateCommand,
  ConversationActivated,
} from '../../contracts';
import {
  ConversationForbiddenError,
  ConversationNotFoundError,
} from '../../domain/errors';

@commandHandler(ConversationActivateCommand)
export class ConversationActivateHandler {
  constructor(
    @inject(ChatService)
    private chatService: ChatService,
    @inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
    @inject(EventBus)
    private eventBus: EventBus,
    @inject(AgentService)
    private readonly agentService: AgentService,
    @inject(CONVERSATION_MEMORY_PORT)
    private readonly convMemory: ConversationMemoryPort,
  ) {}

  async execute(command: ConversationActivateCommand): Promise<void> {
    const { conversationId, userId } = command;
    const dbConversation = await this.convRepo.findById(conversationId);
    if (!dbConversation) {
      throw new ConversationNotFoundError(conversationId);
    }
    if (dbConversation.userId !== userId) {
      throw new ConversationForbiddenError(conversationId, userId);
    }

    const systemPrompt = await this.agentService.getSystemPrompt();

    await this.chatService.activate({
      conversationId,
      userId,
      systemPrompt,
    });

    // 激活 ConversationMemory：一次性灌入当前消息 + 配置（含刚烘焙的 system/context）。
    // 后续 turn 经端口按 conversationId 操作，不再回调 conv 取历史。memory 据此构造会话记忆。
    const [messages, config] = await Promise.all([
      this.chatService.getConversationMessages(conversationId),
      this.chatService.resolveConversationConfig(conversationId),
    ]);
    if (config) {
      this.convMemory.activate(conversationId, messages, config);
    }

    this.eventBus.dispatch(
      ConversationActivated,
      createDomainEvent(ConversationActivated, conversationId, {
        conversationId,
      }),
    );
  }
}
