import { inject } from 'tsyringe';
import { commandHandler } from '@/server/decorator/handler';
import { ChatService } from '../service/chat.service';
import { SessionManager } from '../service/session-manager';
import { AgentService } from '@/server/modules/agent/application/service/agent.service';
import { CONVERSATION_REPOSITORY } from '../../conversation.di-tokens';
import type { ConversationRepositoryPort } from '../../domain/port/conversation.repository.port';
import { ConversationActivateCommand } from '../../contracts';
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
    @inject(AgentService)
    private readonly agentService: AgentService,
    @inject(SessionManager)
    private readonly sessionManager: SessionManager,
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

    // 激活会话记忆：一次性灌入当前消息 + 配置；后续 turn 经会话成员按 conversationId 操作，不再回调 conv。
    const [messages, config] = await Promise.all([
      this.chatService.getConversationMessages(conversationId),
      this.chatService.resolveConversationConfig(conversationId),
    ]);
    if (config) {
      this.sessionManager.activateMemory(conversationId, messages, config);
    }
  }
}
