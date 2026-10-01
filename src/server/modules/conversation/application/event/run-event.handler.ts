import { Inject } from '@nestjs/common';
import { EventsHandler } from '@nestjs/cqrs';
import { RunEvent } from '@/server/modules/agent/contracts';
import { SessionManager } from '../service/session-manager';

/** 会话收到 agent 的每条富化事件，缓冲 + SSE 桥接。 */
@EventsHandler(RunEvent)
export class RunEventHandler {
  constructor(@Inject(SessionManager) private sessionManager: SessionManager) {}

  async handle(event: RunEvent): Promise<void> {
    const { conversationId, messageId, event: enriched } = event.payload;
    this.sessionManager.handleRunEvent(conversationId, messageId, enriched);
  }
}
