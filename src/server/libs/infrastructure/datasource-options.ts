import type { DataSourceOptions } from 'typeorm';
import { AgentRunEntity } from '@/shared/entities/AgentRun';
import { ConversationEntity } from '@/shared/entities/Conversation';
import { ConversationGroupEntity } from '@/shared/entities/ConversationGroup';
import { DocumentChunkEntity } from '@/shared/entities/DocumentChunk';
import { DocumentEntity } from '@/shared/entities/Document';
import { EmailEntity } from '@/shared/entities/Email';
import { MessageEntity } from '@/shared/entities/Message';
import { SettingsEntity } from '@/shared/entities/Settings';
import {
  entities,
  migrations as authMigrations,
} from '@hedystia/better-auth-typeorm';
import { appMigrations } from './migrations';

// 共享 DataSource 配置——服务（database.service.ts）与 CLI（datasource.ts）同源。
// synchronize 关闭：schema 变更走受控迁移（migrations + migrationsRun）。
export function buildDataSourceOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    host: import.meta.env.VITE_PG_HOST,
    port: import.meta.env.VITE_PG_PORT,
    username: import.meta.env.VITE_PG_USERNAME,
    password: import.meta.env.VITE_PG_PASSWORD,
    database: import.meta.env.VITE_PG_DATABASE,
    synchronize: false,
    logging: false,
    entities: [
      ...entities,
      AgentRunEntity,
      ConversationEntity,
      MessageEntity,
      ConversationGroupEntity,
      DocumentEntity,
      DocumentChunkEntity,
      EmailEntity,
      SettingsEntity,
    ],
    migrations: [...authMigrations, ...appMigrations],
    migrationsRun: true,
  };
}
