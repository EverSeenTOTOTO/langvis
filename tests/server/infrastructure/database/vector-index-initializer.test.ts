import { describe, it, expect, vi } from 'vitest';
import { VectorIndexInitializer } from '@/server/infrastructure/database/vector-index-initializer';
import { EMBEDDING_HNSW_INDEX_NAME } from '@/shared/entities/DocumentChunk';
import type { DatabaseService } from '@/server/infrastructure/database/database.service';

function makeMockDb(): DatabaseService {
  return {
    dataSource: { query: vi.fn().mockResolvedValue([]) },
  } as unknown as DatabaseService;
}

describe('VectorIndexInitializer（HNSW 补建）', () => {
  it('onBoot 幂等建索引，名字与实体 synchronize:false 标记同源', async () => {
    const db = makeMockDb();
    await new VectorIndexInitializer(db).onModuleInit();

    expect(db.dataSource.query).toHaveBeenCalledTimes(1);
    const sql = (db.dataSource.query as ReturnType<typeof vi.fn>).mock
      .calls[0]![0] as string;
    expect(sql).toContain(
      `CREATE INDEX IF NOT EXISTS ${EMBEDDING_HNSW_INDEX_NAME}`,
    );
    expect(sql).toContain('ON document_chunks USING hnsw');
    expect(sql).toContain('(embedding vector_cosine_ops)');
  });
});
