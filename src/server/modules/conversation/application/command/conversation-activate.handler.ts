import { inject } from 'tsyringe';
import { commandHandler } from '@/server/decorator/handler';
import { ChatService } from '../service/chat.service';
import { SessionManager } from '../service/session-manager';
import { AgentService } from '@/server/modules/agent/application/service/agent.service';
import { ConversationActivateCommand } from '../../contracts';

@commandHandler(ConversationActivateCommand)
export class ConversationActivateHandler {
  constructor(
    @inject(ChatService)
    private chatService: ChatService,
    @inject(AgentService)
    private readonly agentService: AgentService,
    @inject(SessionManager)
    private readonly sessionManager: SessionManager,
  ) {}

  async execute(command: ConversationActivateCommand): Promise<void> {
    const { conversationId, userId } = command;

    // 归属校验下沉到 ChatService.requireConversation(不存在/非本人统一 NotFound,不泄露存在性)。
    await this.chatService.requireConversation(conversationId, userId);

    const systemPrompt = await this.agentService.getSystemPrompt();

    await this.chatService.activate({
      conversationId,
      userId,
      systemPrompt,
    });

    // 激活会话记忆:一次性灌入当前消息 + 配置;后续 turn 经会话成员按 conversationId 操作,不再回调 conv。
    const [messages, config] = await Promise.all([
      this.chatService.getConversationMessages(conversationId),
      this.chatService.resolveConversationConfig(conversationId),
    ]);
    if (config) {
      this.sessionManager.activateMemory(conversationId, messages, config);
    }
  }
}
