import { Inject } from '@nestjs/common';
import { EventsHandler } from '@nestjs/cqrs';
import { RunStarted } from '@/server/modules/agent/contracts';
import { SessionManager } from '../service/session-manager';
import { ChatService } from '../service/chat.service';

/** 会话收到 agent 的 run 开始信号，自行簿记。registerRun 须在首条 RunEvent 前同步完成。 */
@EventsHandler(RunStarted)
export class RunStartedHandler {
  constructor(
    @Inject(SessionManager) private sessionManager: SessionManager,
    @Inject(ChatService) private chatService: ChatService,
  ) {}

  async handle(event: RunStarted): Promise<void> {
    const { conversationId, messageId, runId } = event.payload;
    this.sessionManager.registerRun(conversationId, messageId, runId);
    await this.chatService.persistAgentRunId(messageId, runId);
  }
}
