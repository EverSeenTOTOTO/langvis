import { inject } from 'tsyringe';
import type { DomainEvent } from '@/server/libs/ddd';
import { eventHandler } from '@/server/decorator/handler';
import { RunStarted } from '@/server/modules/conversation/contracts';
import type { RunStartedPayload } from '@/server/modules/conversation/contracts';
import { SessionManager } from '../service/session-manager';
import { ChatService } from '../service/chat.service';

/**
 * RunStartedHandler —— 会话收到 agent 的 run 开始信号，自行簿记。
 * registerRun 创建事件缓冲（**同步**，须在首条 RunEvent 前完成）；persistAgentRunId 落 message。
 */
@eventHandler(RunStarted)
export class RunStartedHandler {
  constructor(
    @inject(SessionManager) private sessionManager: SessionManager,
    @inject(ChatService) private chatService: ChatService,
  ) {}

  async handle(event: DomainEvent<string, RunStartedPayload>): Promise<void> {
    const { conversationId, messageId, runId } = event.payload;
    this.sessionManager.registerRun(conversationId, messageId, runId);
    await this.chatService.persistAgentRunId(messageId, runId);
  }
}
