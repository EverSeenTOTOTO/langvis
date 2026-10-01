import { describe, it, expect } from 'vitest';
import { buildDataSourceOptions } from '@/server/infrastructure/database/datasource-options';
import { BaselineSchema1788134400001 } from '@/server/infrastructure/database/migrations/1788134400001-BaselineSchema';
import { RestoreAuthUniqueIndexes1788134400002 } from '@/server/infrastructure/database/migrations/1788134400002-RestoreAuthUniqueIndexes';

type MigrationCtor =
  | typeof BaselineSchema1788134400001
  | typeof RestoreAuthUniqueIndexes1788134400002;

describe('buildDataSourceOptions（sync 关闭 + 受控迁移）', () => {
  it('synchronize 关闭、migrationsRun 开——schema 变更走迁移而非 boot 现场 diff', () => {
    const opts = buildDataSourceOptions();
    expect(opts.synchronize).toBe(false);
    expect(opts.migrationsRun).toBe(true);
  });

  it('迁移链含 baseline + restore——auth 4 条在前、app 2 条在后', () => {
    const migrations = buildDataSourceOptions()
      .migrations as unknown as MigrationCtor[];
    expect(migrations).toContain(BaselineSchema1788134400001);
    expect(migrations).toContain(RestoreAuthUniqueIndexes1788134400002);
    expect(migrations.indexOf(BaselineSchema1788134400001)).toBeLessThan(
      migrations.indexOf(RestoreAuthUniqueIndexes1788134400002),
    );
  });
});
