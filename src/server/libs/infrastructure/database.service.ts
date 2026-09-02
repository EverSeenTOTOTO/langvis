import {
  DataSource,
  type EntityTarget,
  type EntityManager,
  type Repository,
} from 'typeorm';
import { AsyncLocalStorage } from 'node:async_hooks';
import logger from '@/server/utils/logger';
import { service } from '@/server/decorator/service';
import {
  lifecycleHook,
  type LifecycleHook,
} from '@/server/decorator/lifecycle';
import type { TransactionPort } from '@/server/libs/ports/transaction/transaction.port';
import { buildDataSourceOptions } from './datasource-options';

@service()
@lifecycleHook
export class DatabaseService implements LifecycleHook, TransactionPort {
  private _dataSource: DataSource | null = null;
  private readonly initPromise: Promise<void>;

  private readonly dataSourceConfig = buildDataSourceOptions();

  /** 活动事务的 mgr：transaction() 内 run(mgr)，getRepository 据此分流到事务 mgr，事务外 getStore()=undefined 走默认 repo。 */
  private readonly txStore = new AsyncLocalStorage<EntityManager>();

  constructor() {
    this.initPromise = this.initialize();
  }

  private async initialize(): Promise<void> {
    if (this._dataSource?.isInitialized) return;

    const start = Date.now();
    logger.debug('Initializing PostgreSQL connection...');

    this._dataSource = new DataSource(this.dataSourceConfig);
    await this._dataSource.initialize();

    logger.info(`PostgreSQL connected in ${Date.now() - start}ms.`);
  }

  /** 启动钩子：连上后再对外服务——后续 hook（如孤儿 run 清扫）依赖 DB 就绪。 */
  async onBoot(): Promise<void> {
    await this.initPromise;
  }

  get dataSource(): DataSource {
    if (!this._dataSource) {
      throw new Error('DatabaseService not initialized');
    }
    return this._dataSource;
  }

  getRepository<T extends object>(entity: EntityTarget<T>): Repository<T> {
    // 活动事务内用其 mgr 取 repo → 同一事务、同一 queryrunner；事务外回落默认 repo（行为不变）。
    const mgr = this.txStore.getStore();
    return (mgr ?? this.dataSource).getRepository(entity);
  }

  get isInitialized(): boolean {
    return this._dataSource?.isInitialized ?? false;
  }

  /** 在单一事务内执行 work：把 mgr 装进 ALS，work 内 repo 调用自动绑同一 mgr；work 抛错回滚并重抛。 */
  transaction<T>(work: () => Promise<T>): Promise<T> {
    return this.dataSource.transaction(async mgr =>
      this.txStore.run(mgr, () => work()),
    );
  }

  async onShutdown(): Promise<void> {
    if (this._dataSource?.isInitialized) {
      await this._dataSource.destroy();
      logger.info('PostgreSQL connection closed');
    }
  }
}
