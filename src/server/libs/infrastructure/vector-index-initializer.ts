import { inject, singleton } from 'tsyringe';
import {
  lifecycleHook,
  type LifecycleHook,
} from '@/server/decorator/lifecycle';
import Logger from '@/server/utils/logger';
import { EMBEDDING_HNSW_INDEX_NAME } from '@/shared/entities/DocumentChunk';
import { DatabaseService } from './database.service';

// HNSW 补建（启动用例）：ORM 表达不了 USING hnsw + opclass，实体上只挂同名
// synchronize:false 标记防误删，索引本体在此幂等创建（注入 DatabaseService 保证排在 DataSource 就绪后）。
@singleton()
@lifecycleHook
export class VectorIndexInitializer implements LifecycleHook {
  private readonly logger = Logger.child({ source: 'VectorIndexInitializer' });

  constructor(@inject(DatabaseService) private readonly db: DatabaseService) {}

  async onBoot(): Promise<void> {
    await this.db.dataSource.query(
      `CREATE INDEX IF NOT EXISTS ${EMBEDDING_HNSW_INDEX_NAME} ON document_chunks USING hnsw (embedding vector_cosine_ops)`,
    );
    this.logger.debug(`HNSW index ready: ${EMBEDDING_HNSW_INDEX_NAME}`);
  }
}
