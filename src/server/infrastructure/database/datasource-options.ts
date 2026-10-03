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
    // 运行时经 dotenv 进 process.env（tsx 直跑/Node prod 通用）；vite 构建路径同值注入。
    host: process.env.VITE_PG_HOST,
    port: Number(process.env.VITE_PG_PORT),
    username: process.env.VITE_PG_USERNAME,
    password: process.env.VITE_PG_PASSWORD,
    database: process.env.VITE_PG_DATABASE,
    // 快速失败：DB 不可达时 pg 默认无 connect timeout，会静默挂到内核 TCP 超时（分钟级）
    connectTimeoutMS: 10_000,
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
