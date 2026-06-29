import { describe, it, expect, vi } from 'vitest';
import { LoopUsageSseHandler } from '@/server/modules/conversation/application/event/context-usage-sse.handler';
import type { SessionManager } from '@/server/modules/conversation/application/service/session-manager';
import type { DomainEvent } from '@/server/libs/ddd';
import type { LoopUsageReportedPayload } from '@/server/modules/memory';

function mockSessionManager(
  loc: {
    conversationId: string;
    messageId: string;
  } | null,
) {
  return {
    findByRunId: vi.fn().mockReturnValue(loc),
    sendFrame: vi.fn().mockReturnValue(true),
  } as unknown as SessionManager;
}

describe('LoopUsageSseHandler', () => {
  it('按 runId 反查命中 → 发 loop_usage 帧（带 runId）', () => {
    const sm = mockSessionManager({
      conversationId: 'conv_1',
      messageId: 'msg_1',
    });
    new LoopUsageSseHandler(sm).handle({
      payload: { runId: 'run_1', used: 100, total: 1000 },
    } as DomainEvent<string, LoopUsageReportedPayload>);

    expect(sm.sendFrame).toHaveBeenCalledWith('conv_1', {
      type: 'loop_usage',
      runId: 'run_1',
      used: 100,
      total: 1000,
    });
  });

  it('反查未命中（run 未登记/会话已释放）→ 不发帧', () => {
    const sm = mockSessionManager(null);
    new LoopUsageSseHandler(sm).handle({
      payload: { runId: 'run_x', used: 1, total: 2 },
    } as DomainEvent<string, LoopUsageReportedPayload>);

    expect(sm.sendFrame).not.toHaveBeenCalled();
  });
});
