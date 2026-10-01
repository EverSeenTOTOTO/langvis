import { OnModuleInit, OnApplicationShutdown } from '@nestjs/common';
import { DataSource, type EntityTarget, type Repository } from 'typeorm';
import {
  addTransactionalDataSource,
  runInTransaction,
} from 'typeorm-transactional';
import logger from '@/server/utils/logger';
import type { TransactionPort } from '@/server/infrastructure/database/transaction.port';
import { buildDataSourceOptions } from './datasource-options';

export class DatabaseService
  implements TransactionPort, OnModuleInit, OnApplicationShutdown
{
  private _dataSource: DataSource | null = null;
  private readonly initPromise: Promise<void>;

  private readonly dataSourceConfig = buildDataSourceOptions();

  constructor() {
    this.initPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    if (this._dataSource?.isInitialized) return;

    const start = Date.now();
    logger.debug('Initializing PostgreSQL connection...');

    // 注册进 typeorm-transactional：getRepository 经其原型补丁感知
    // runInTransaction 建立的 ALS 事务 mgr（事务外回落默认 repo，行为不变）。
    this._dataSource = addTransactionalDataSource(
      new DataSource(this.dataSourceConfig),
    );
    await this._dataSource.initialize();

    logger.info(`PostgreSQL connected in ${Date.now() - start}ms.`);
  }

  /** 启动钩子：连上后再对外服务——后续 hook（如孤儿 run 清扫）依赖 DB 就绪。 */
  async onModuleInit(): Promise<void> {
    await this.initPromise;
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

  /** 在单一事务内执行 work：runInTransaction 建立 ALS 事务，work 内 getRepository 自动绑同一 mgr；work 抛错回滚并重抛。 */
  transaction<T>(work: () => Promise<T>): Promise<T> {
    return runInTransaction(work);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this._dataSource?.isInitialized) {
      await this._dataSource.destroy();
      logger.info('PostgreSQL connection closed');
    }
  }
}
