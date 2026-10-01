import { MigrationInterface, QueryRunner } from 'typeorm';

// 修复被 dropOldIndices 删除的 auth UNIQUE 索引——名字对齐 submodule migration。
// 顺带清 emails 孤儿表；sync 关闭后不再删改。
export class RestoreAuthUniqueIndexes1788134400002
  implements MigrationInterface
{
  name = 'RestoreAuthUniqueIndexes1788134400002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_user_email" ON "user" ("email")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_session_token" ON "session" ("token")`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "emails"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_user_email"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_session_token"`);
  }
}
