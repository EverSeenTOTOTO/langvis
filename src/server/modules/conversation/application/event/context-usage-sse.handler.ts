import { inject } from 'tsyringe';
import type { DomainEvent } from '@/server/libs/ddd';
import { eventHandler } from '@/server/decorator/handler';
import { LoopUsageReported } from '@/server/modules/agent/contracts';
import type { LoopUsageReportedPayload } from '@/server/modules/agent/contracts';
import { SessionManager } from '../service/session-manager';

/**
 * 把 agent loop 的用量自报桥接为会话级 SSE 控制帧。LoopUsageReported 仅带 runId，
 * 按 SessionManager 反查会话路由；查不到（未登记/会话已释放）则忽略——无连接可发，安全降级。
 * 会话层用量不经事件，conv 自算后直接 sendFrame。
 */
@eventHandler(LoopUsageReported)
export class LoopUsageSseHandler {
  constructor(@inject(SessionManager) private readonly sm: SessionManager) {}

  handle(event: DomainEvent<string, LoopUsageReportedPayload>): void {
    const { runId, used, total } = event.payload;
    const loc = this.sm.findByRunId(runId);
    if (!loc) return;
    this.sm.sendFrame(loc.conversationId, {
      type: 'loop_usage',
      runId,
      used,
      total,
    });
  }
}
