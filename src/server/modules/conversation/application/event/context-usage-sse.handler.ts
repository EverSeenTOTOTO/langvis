import { inject } from 'tsyringe';
import type { DomainEvent } from '@/server/libs/ddd';
import { eventHandler } from '@/server/decorator/handler';
import { LoopUsageReported } from '@/server/modules/memory';
import type { LoopUsageReportedPayload } from '@/server/modules/memory';
import { SessionManager } from '../service/session-manager';

/**
 * LoopUsageSseHandler —— 把 memory 的 loop 用量自报桥接为会话级 SSE 控制帧。
 *
 * LoopUsageReported（仅 runId，WorkingMemory 在 record/compact 时自报）：按 SessionManager
 * 反查 runId→会话，转 loop_usage 帧；查不到（未登记/会话已释放）则忽略——无连接可发，安全降级。
 *
 * 会话层用量（conversation_usage）不再经事件——conv 自算（ConversationMemoryService）后直接
 * sendFrame（见 ConversationActivatedUsageHandler / CompleteTurnHandler）。
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
