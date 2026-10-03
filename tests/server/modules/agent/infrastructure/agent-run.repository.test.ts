import { describe, it, expect } from 'vitest';
import { OptimisticLockVersionMismatchError } from 'typeorm';
import { AgentRunRepository } from '@/server/modules/agent/infrastructure/persistence/agent-run.repository';
import { DatabaseService } from '@/server/infrastructure/database/database.service';
import { AgentRunConcurrentModificationError } from '@/server/modules/agent/domain/errors';
import type { EnrichedEvent } from '@/shared/types/events';

// 契约级测试：复用真实 AgentRunRepository，mock TypeORM Repository 复刻 @Version 乐观锁。
// 验证并发写冲突抛 AgentRunConcurrentModificationError，而非静默覆盖。

const RUN_ID = 'run_test';
const startedAt = new Date('2026-01-01T00:00:00Z');

type FakeRow = Record<string, unknown> & { id: string; version: number };

function makeFakeRepo() {
  const store = new Map<string, FakeRow>();

  const repo = {
    findOneBy: async ({ id }: { id: string }): Promise<FakeRow | null> => {
      const row = store.get(id);
      // 每次读取返回脱离 store 的拷贝——模拟真实的「读时取当前版本，写时校验」。
      return row ? { ...row } : null;
    },
    insert: async (entity: FakeRow): Promise<void> => {
      store.set(entity.id, { ...entity, version: entity.version ?? 0 });
    },
    save: async (entity: FakeRow): Promise<FakeRow> => {
      const existing = store.get(entity.id);
      if (existing) {
        const entityVersion = entity.version ?? 0;
        if (existing.version !== entityVersion) {
          throw new OptimisticLockVersionMismatchError(
            'version conflict',
            entityVersion,
            existing.version,
          );
        }
        const saved = { ...entity, version: existing.version + 1 };
        store.set(entity.id, saved);
        return { ...saved };
      }
      const saved = { ...entity, version: entity.version ?? 0 };
      store.set(entity.id, saved);
      return { ...saved };
    },
    find: async (): Promise<FakeRow[]> => [...store.values()],
  };

  return { repo, store };
}

function mkEvents(...contents: string[]): EnrichedEvent[] {
  return contents.map((content, i) => ({
    type: 'thought' as const,
    runId: RUN_ID,
    at: i + 1,
    content,
  }));
}

describe('AgentRunRepository（乐观锁契约）', () => {
  it('顺序 update 不冲突（既有路径不回归）', async () => {
    const { repo: fakeRepo } = makeFakeRepo();
    const repo = new AgentRunRepository({
      getRepository: () => fakeRepo,
    } as unknown as DatabaseService);

    await repo.save({
      id: RUN_ID,
      status: 'running',
      events: [],
      config: null,
      startedAt,
      completedAt: null,
    });

    await repo.update(RUN_ID, { status: 'completed' });
    await repo.update(RUN_ID, { completedAt: new Date() });

    const row = (await fakeRepo.findOneBy({ id: RUN_ID })) as FakeRow;
    expect(row.status).toBe('completed');
    expect(row.version).toBe(2);
  });

  it('两个并发 commit 同一 run：后写方抛 AgentRunConcurrentModificationError，不静默覆盖', async () => {
    const { repo: fakeRepo } = makeFakeRepo();
    const repo = new AgentRunRepository({
      getRepository: () => fakeRepo,
    } as unknown as DatabaseService);
    await repo.save({
      id: RUN_ID,
      status: 'running',
      events: [],
      config: null,
      startedAt,
      completedAt: null,
    });

    const eventsA = mkEvents('a');
    const eventsB = mkEvents('b');

    const [a, b] = await Promise.allSettled([
      repo.commit(RUN_ID, {
        events: eventsA,
        status: 'completed',
        completedAt: new Date(),
      }),
      repo.commit(RUN_ID, {
        events: eventsB,
        status: 'cancelled',
        completedAt: new Date(),
      }),
    ]);

    expect(a.status).toBe('fulfilled');
    const bReason = b.status === 'rejected' ? b.reason : null;
    expect(bReason).toBeInstanceOf(AgentRunConcurrentModificationError);
  });

  it('并发 update 冲突同样被包装成 AgentRunConcurrentModificationError', async () => {
    const { repo: fakeRepo } = makeFakeRepo();
    const repo = new AgentRunRepository({
      getRepository: () => fakeRepo,
    } as unknown as DatabaseService);
    await repo.save({
      id: RUN_ID,
      status: 'running',
      events: [],
      config: null,
      startedAt,
      completedAt: null,
    });

    const [, second] = await Promise.allSettled([
      repo.update(RUN_ID, { status: 'completed' }),
      repo.update(RUN_ID, { status: 'failed' }),
    ]);

    const secondReason = second.status === 'rejected' ? second.reason : null;
    expect(secondReason).toBeInstanceOf(AgentRunConcurrentModificationError);
  });

  it('冲突后重新加载最新版本再 commit 可成功（executor 重试路径的契约）', async () => {
    const { repo: fakeRepo } = makeFakeRepo();
    const repo = new AgentRunRepository({
      getRepository: () => fakeRepo,
    } as unknown as DatabaseService);
    await repo.save({
      id: RUN_ID,
      status: 'running',
      events: [],
      config: null,
      startedAt,
      completedAt: null,
    });

    await repo.commit(RUN_ID, {
      events: mkEvents('a'),
      status: 'completed',
      completedAt: new Date(),
    });

    // 重新读库拿最新版本后再 commit → 成功，版本继续递增
    const result = await repo.commit(RUN_ID, {
      events: mkEvents('a', 'b'),
      status: 'completed',
      completedAt: new Date(),
    });

    expect(result).not.toBeNull();
    const row = (await fakeRepo.findOneBy({ id: RUN_ID })) as FakeRow;
    expect(row.version).toBe(2);
  });

  it('commit 对不存在的 run 返回 null', async () => {
    const { repo: fakeRepo } = makeFakeRepo();
    const repo = new AgentRunRepository({
      getRepository: () => fakeRepo,
    } as unknown as DatabaseService);

    const result = await repo.commit(RUN_ID, {
      events: [],
      status: 'failed',
      completedAt: new Date(),
    });

    expect(result).toBeNull();
  });

  it('checkpoint 只更新 events，status 保持 running，版本递增', async () => {
    const { repo: fakeRepo } = makeFakeRepo();
    const repo = new AgentRunRepository({
      getRepository: () => fakeRepo,
    } as unknown as DatabaseService);
    await repo.save({
      id: RUN_ID,
      status: 'running',
      events: [],
      config: null,
      startedAt,
      completedAt: null,
    });

    const saved = await repo.checkpoint(RUN_ID, mkEvents('a', 'b'));

    const row = (await fakeRepo.findOneBy({ id: RUN_ID })) as FakeRow;
    expect(saved).not.toBeNull();
    expect(row.status).toBe('running');
    expect(row.completedAt).toBeNull();
    expect((row.events as EnrichedEvent[]).length).toBe(2);
    expect(row.version).toBe(1);
  });

  it('并发 checkpoint 同一 run：后写方抛 AgentRunConcurrentModificationError', async () => {
    const { repo: fakeRepo } = makeFakeRepo();
    const repo = new AgentRunRepository({
      getRepository: () => fakeRepo,
    } as unknown as DatabaseService);
    await repo.save({
      id: RUN_ID,
      status: 'running',
      events: [],
      config: null,
      startedAt,
      completedAt: null,
    });

    const [, second] = await Promise.allSettled([
      repo.checkpoint(RUN_ID, mkEvents('a')),
      repo.checkpoint(RUN_ID, mkEvents('b')),
    ]);

    const secondReason = second.status === 'rejected' ? second.reason : null;
    expect(secondReason).toBeInstanceOf(AgentRunConcurrentModificationError);
  });
});
