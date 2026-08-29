import { describe, it, expect } from 'vitest';
import { RunViewCache } from '@/server/modules/conversation/application/service/run-view-cache';
import type { RunStatus } from '@/shared/types/agent';
import type { EnrichedEvent } from '@/shared/types/events';

const RUN_ID = 'run_1';

function makeRun(
  status: RunStatus,
  events: EnrichedEvent[],
): { id: string; status: RunStatus; events: EnrichedEvent[] | null } {
  return { id: RUN_ID, status, events };
}

function mkText(content: string): EnrichedEvent {
  return { type: 'text_chunk', runId: RUN_ID, at: 1, content } as EnrichedEvent;
}

describe('RunViewCache', () => {
  it('终态 run 两次 project 返回同一引用（命中缓存，不重 fold）', () => {
    const cache = new RunViewCache();
    const run = makeRun('completed', [mkText('hello')]);

    const first = cache.project(run);
    const second = cache.project(run);

    expect(second).toBe(first);
    expect(first.content).toBe('hello');
  });

  it('非终态 run 不入缓存：events 变化后投影跟随变化', () => {
    const cache = new RunViewCache();

    const first = cache.project(makeRun('running', [mkText('a')]));
    const second = cache.project(
      makeRun('running', [mkText('a'), mkText('b')]),
    );

    expect(second).not.toBe(first);
    expect(first.content).toBe('a');
    expect(second.content).toBe('ab');

    // running 期间入不了缓存：翻终态后首次读仍是新 fold（而非 stale 快照）
    const third = cache.project(
      makeRun('completed', [mkText('a'), mkText('b')]),
    );
    expect(third).not.toBe(first);
    expect(third.content).toBe('ab');
  });

  it('超过容量逐出最旧；被访问过的旧条目因新近度刷新存活', () => {
    const cache = new RunViewCache();
    cache.maxEntries = 2;

    const a = cache.project(makeRun('completed', [mkText('a')]));
    cache.project({ id: 'run_2', status: 'completed', events: [mkText('x')] });
    // 访问 a 刷新新近度 → run_2 成最旧
    expect(cache.project(makeRun('completed', [mkText('a')]))).toBe(a);
    cache.project({ id: 'run_3', status: 'completed', events: [mkText('y')] });

    // 容量 2：run_2 被逐出（重新 fold 得新引用），a/run_3 仍命中
    const aAgain = cache.project(makeRun('completed', [mkText('a')]));
    expect(aAgain).toBe(a);
    const fresh = cache.project({
      id: 'run_2',
      status: 'completed',
      events: [mkText('x')],
    });
    expect(fresh).not.toBe(a);
    expect(fresh.content).toBe('x');
  });
});
