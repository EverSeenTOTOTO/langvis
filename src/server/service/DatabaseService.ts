import { ConversationEntity } from '@/shared/entities/Conversation';
import { ConversationGroupEntity } from '@/shared/entities/ConversationGroup';
import { DocumentChunkEntity } from '@/shared/entities/DocumentChunk';
import { DocumentEntity } from '@/shared/entities/Document';
import { EmailEntity } from '@/shared/entities/Email';
import { MessageEntity } from '@/shared/entities/Message';
import { SettingsEntity } from '@/shared/entities/Settings';
import { entities, migrations } from '@hedystia/better-auth-typeorm';
import { DataSource, type EntityTarget, type Repository } from 'typeorm';
import logger from '../utils/logger';
import { service } from '../decorator/service';

@service()
export class DatabaseService {
  private _dataSource: DataSource | null = null;

  private readonly dataSourceConfig = {
    type: 'postgres' as const,
    host: import.meta.env.VITE_PG_HOST,
    port: import.meta.env.VITE_PG_PORT,
    username: import.meta.env.VITE_PG_USERNAME,
    password: import.meta.env.VITE_PG_PASSWORD,
    database: import.meta.env.VITE_PG_DATABASE,
    synchronize: true,
    logging: false,
    entities: [
      ...entities,
      ConversationEntity,
      MessageEntity,
      ConversationGroupEntity,
      DocumentEntity,
      DocumentChunkEntity,
      EmailEntity,
      SettingsEntity,
    ],
    migrations: [...migrations],
    migrationsRun: true,
  };

  constructor() {
    this.initialize();
  }

  private async initialize(): Promise<void> {
    if (this._dataSource?.isInitialized) return;

    const start = Date.now();
    logger.info('Initializing PostgreSQL connection...');

    this._dataSource = new DataSource(this.dataSourceConfig);
    await this._dataSource.initialize();

    logger.info(`PostgreSQL connected in ${Date.now() - start}ms.`);
  }

  get dataSource(): DataSource {
    if (!this._dataSource) {
      throw new Error('DatabaseService not initialized');
    }
    return this._dataSource;
  }

  getRepository<T extends object>(entity: EntityTarget<T>): Repository<T> {
    return this.dataSource.getRepository(entity);
  }

  get isInitialized(): boolean {
    return this._dataSource?.isInitialized ?? false;
  }
}
