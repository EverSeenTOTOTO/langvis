import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import dotenv from 'dotenv';
import { initializeTransactionalContext } from 'typeorm-transactional';
import { afterAll, describe, expect, it } from 'vitest';
import { DatabaseService } from '@/server/infrastructure/database/database.service';
import { UserEntity } from '@/shared/entities/User';

dotenv.config({
  path: path.join(process.cwd(), '.env.development'),
});
initializeTransactionalContext();

// DB 不可达（无本地 PG / 隧道断）时整组跳过——迁移期事务穿透是关键不变量，宁跳不假绿。
// connect 经死隧道会无限挂起而非快速拒绝，须限时竞速判定可达性。
let db: DatabaseService | null = null;
try {
  const candidate = new DatabaseService();
  candidate.onModuleInit().catch(() => {});
  await Promise.race([
    candidate.onModuleInit(),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('db unreachable')), 10_000),
    ),
  ]);
  db = candidate;
} catch {
  db = null;
}

const probeUser = (id: string) => ({
  id,
  name: 'tx-probe',
  email: `tx-probe-${id}@langvis.test`,
});

describe.skipIf(db === null)(
  'DatabaseService 事务穿透（typeorm-transactional）',
  () => {
    const service = db as DatabaseService;

    afterAll(async () => {
      await service.onApplicationShutdown();
    });

    it('事务内 repo 写入随提交持久化', async () => {
      const id = randomUUID();

      await service.transaction(async () => {
        await service.getRepository(UserEntity).insert(probeUser(id));
        // 事务内重新 getRepository（非缓存同一引用的场景）仍须读到未提交行
        const inTx = await service
          .getRepository(UserEntity)
          .findOneByOrFail({ id });
        expect(inTx.email).toBe(probeUser(id).email);
      });

      // 提交后事务外可见
      await expect(
        service.getRepository(UserEntity).findOneByOrFail({ id }),
      ).resolves.toBeDefined();
      await service.getRepository(UserEntity).delete({ id });
    });

    it('事务抛错整体回滚——ALS 断裂时行会存留，此测试即失败', async () => {
      const id = randomUUID();

      await expect(
        service.transaction(async () => {
          await service.getRepository(UserEntity).insert(probeUser(id));
          throw new Error('intended rollback');
        }),
      ).rejects.toThrow('intended rollback');

      expect(
        await service.getRepository(UserEntity).findOneBy({ id }),
      ).toBeNull();
    });

    it('事务外 repo 写入即时独立提交（无隐式事务泄漏）', async () => {
      const id = randomUUID();
      await service.getRepository(UserEntity).insert(probeUser(id));
      await expect(
        service.getRepository(UserEntity).findOneByOrFail({ id }),
      ).resolves.toBeDefined();
      await service.getRepository(UserEntity).delete({ id });
    });
  },
);
