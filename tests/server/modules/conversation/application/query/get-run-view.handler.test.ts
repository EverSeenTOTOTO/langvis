import { describe, it, expect, vi } from 'vitest';
import { GetRunViewHandler } from '@/server/modules/conversation/application/query/get-run-view.handler';
import { GetRunViewQuery } from '@/server/modules/conversation/contracts';
import { RunViewCache } from '@/server/modules/conversation/application/service/run-view-cache';
import type { SessionManager } from '@/server/modules/conversation/application/service/session-manager';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import type { EnrichedEvent } from '@/shared/types/events';

describe('GetRunViewHandler', () => {
  it('持久化分支：终态 run 两次查询 view 同一引用（缓存命中）', async () => {
    const sessionManager = {
      getChildRunEvents: vi.fn().mockReturnValue(undefined),
    } as unknown as SessionManager;
    const agentRunRepo = {
      findById: vi.fn().mockResolvedValue({
        id: 'run_1',
        status: 'completed',
        events: [
          { type: 'text_chunk', runId: 'run_1', at: 1, content: 'hi' },
        ] as EnrichedEvent[],
      }),
    } as unknown as AgentRunRepositoryPort;

    const handler = new GetRunViewHandler(
      sessionManager,
      agentRunRepo,
      new RunViewCache(),
    );
    const first = await handler.execute(new GetRunViewQuery('run_1'));
    const second = await handler.execute(new GetRunViewQuery('run_1'));

    expect(first?.view).toBe(second?.view);
    expect(first?.view.content).toBe('hi');
  });

  it('live 分支不走缓存：session 缓冲每次重 fold，view 引用不同', async () => {
    const liveEvents: EnrichedEvent[] = [
      { type: 'text_chunk', runId: 'run_child', at: 1, content: 'a' },
    ];
    const sessionManager = {
      getChildRunEvents: vi.fn().mockImplementation(() => [...liveEvents]),
    } as unknown as SessionManager;
    const agentRunRepo = {
      findById: vi.fn(),
    } as unknown as AgentRunRepositoryPort;

    const handler = new GetRunViewHandler(
      sessionManager,
      agentRunRepo,
      new RunViewCache(),
    );
    const first = await handler.execute(new GetRunViewQuery('run_child'));
    // 缓冲增长 → 新 fold 反映新事件，而非缓存旧 view
    liveEvents.push({
      type: 'text_chunk',
      runId: 'run_child',
      at: 2,
      content: 'b',
    } as EnrichedEvent);
    const second = await handler.execute(new GetRunViewQuery('run_child'));

    expect(second?.view).not.toBe(first?.view);
    expect(second?.view.content).toBe('ab');
    expect(agentRunRepo.findById).not.toHaveBeenCalled();
  });

  it('run 不存在时返回 null', async () => {
    const sessionManager = {
      getChildRunEvents: vi.fn().mockReturnValue(undefined),
    } as unknown as SessionManager;
    const agentRunRepo = {
      findById: vi.fn().mockResolvedValue(null),
    } as unknown as AgentRunRepositoryPort;

    const handler = new GetRunViewHandler(
      sessionManager,
      agentRunRepo,
      new RunViewCache(),
    );
    const result = await handler.execute(new GetRunViewQuery('run_missing'));

    expect(result).toBeNull();
  });
});
