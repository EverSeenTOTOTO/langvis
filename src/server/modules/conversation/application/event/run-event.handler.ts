import { inject } from 'tsyringe';
import type { DomainEvent } from '@/server/libs/ddd';
import { eventHandler } from '@/server/decorator/handler';
import { RunEvent } from '@/server/modules/conversation/contracts';
import type { RunEventPayload } from '@/server/modules/conversation/contracts';
import { SessionManager } from '../service/session-manager';

/**
 * RunEventHandler —— 会话收到 agent 的每条富化事件，缓冲 + SSE 桥接。
 * （取代此前 agent 直接调 sessionManager.processRunEvent 的硬耦合。）
 */
@eventHandler(RunEvent)
export class RunEventHandler {
  constructor(@inject(SessionManager) private sessionManager: SessionManager) {}

  async handle(event: DomainEvent<string, RunEventPayload>): Promise<void> {
    const { conversationId, messageId, event: enriched } = event.payload;
    this.sessionManager.handleRunEvent(conversationId, messageId, enriched);
  }
}
