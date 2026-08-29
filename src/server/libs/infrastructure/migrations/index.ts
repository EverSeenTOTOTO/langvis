import { BaselineSchema1788134400001 } from './1788134400001-BaselineSchema';
import { RestoreAuthUniqueIndexes1788134400002 } from './1788134400002-RestoreAuthUniqueIndexes';

// app 迁移链——auth 4 条由 better-auth submodule 提供，在 datasource-options 里
// 拼在 authMigrations 之后。新增迁移 append 进此数组（时间戳递增）。
export const appMigrations = [
  BaselineSchema1788134400001,
  RestoreAuthUniqueIndexes1788134400002,
];
