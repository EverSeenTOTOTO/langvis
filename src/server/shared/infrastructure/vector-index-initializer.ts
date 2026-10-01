import Logger from '@/server/utils/logger';
import { EMBEDDING_HNSW_INDEX_NAME } from '@/shared/entities/DocumentChunk';
import { Inject, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from './database.service';

// HNSW 补建（启动用例）：ORM 表达不了 USING hnsw + opclass，实体上只挂同名
// synchronize:false 标记防误删，索引本体在此幂等创建（注入 DatabaseService 保证排在 DataSource 就绪后）。
export class VectorIndexInitializer implements OnModuleInit {
  private readonly logger = Logger.child({ source: 'VectorIndexInitializer' });

  constructor(@Inject(DatabaseService) private readonly db: DatabaseService) {}

  async onModuleInit(): Promise<void> {
    await this.db.dataSource.query(
      `CREATE INDEX IF NOT EXISTS ${EMBEDDING_HNSW_INDEX_NAME} ON document_chunks USING hnsw (embedding vector_cosine_ops)`,
    );
    this.logger.debug(`HNSW index ready: ${EMBEDDING_HNSW_INDEX_NAME}`);
  }
}
