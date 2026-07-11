import { inject } from 'tsyringe';
import { commandHandler } from '@/server/decorator/handler';
import { ChatService } from '../service/chat.service';
import { SessionManager } from '../service/session-manager';
import { AgentService } from '@/server/modules/agent/application/service/agent.service';
import { ConversationActivateCommand } from '../../contracts';
import { runConvTransforms } from '../transforms';

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

    // ensure
    await this.chatService.requireConversation(conversationId, userId);

    const systemPrompt = await this.agentService.getSystemPrompt();

    await this.chatService.activate({
      conversationId,
      userId,
      systemPrompt,
    });

    // 激活会话上下文：一次性灌入当前消息 + 解析后的 runtimeConfig + 解析 transform 管道。
    const [messages, runtimeConfig] = await Promise.all([
      this.chatService.getConversationMessages(conversationId),
      this.chatService.resolveConversationConfig(conversationId),
    ]);
    if (!runtimeConfig) return;

    this.sessionManager.activateContext(
      conversationId,
      messages,
      runtimeConfig,
    );

    // activated-phase transform（usage 基线等）。激活先于任何 turn，无需屏障。
    const ctx = this.sessionManager.getCtx(conversationId);
    for await (const frame of runConvTransforms(ctx, 'activated')) {
      if (frame) this.sessionManager.sendFrame(conversationId, frame);
    }
  }
}
