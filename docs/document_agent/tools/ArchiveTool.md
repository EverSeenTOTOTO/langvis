# ArchiveTool

## 概述

ArchiveTool 负责将文档元数据和向量化后的分块存储到数据库。

## 职责

- 创建文档记录
- 批量创建分块记录
- 管理事务一致性

## 输入

```typescript
interface ArchiveInput {
  // 文档元信息
  document: {
    title: string;
    summary: string;
    keywords: string[];
    category: string;
    metadata: Record<string, unknown>;
    sourceUrl?: string;
    sourceType: string;
    rawContent: string;
  };

  // 向量化后的分块
  chunks: Array<{
    content: string;
    index: number;
    embedding: number[];
    metadata?: Record<string, unknown>;
  }>;
}
```

## 输出

```typescript
interface ArchiveOutput {
  documentId: string; // 文档 ID
  chunkCount: number; // 分块数量
}
```

## 事务管理

使用 TypeORM 事务保证原子性：

```typescript
@tool(ToolIds.ARCHIVE)
export default class ArchiveTool extends Tool<ArchiveInput, ArchiveOutput> {
  constructor(
    private documentRepo: Repository<Document>,
    private chunkRepo: Repository<DocumentChunk>,
  ) {
    super();
  }

  async *call(
    @input() params: ArchiveInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, ArchiveOutput, void> {
    const { document, chunks } = params;

    // 使用事务
    const result = await this.documentRepo.manager.transaction(
      async manager => {
        // 创建文档
        const doc = manager.create(Document, {
          title: document.title,
          summary: document.summary,
          keywords: document.keywords,
          category: document.category,
          metadata: document.metadata,
          sourceUrl: document.sourceUrl,
          sourceType: document.sourceType,
          rawContent: document.rawContent,
        });
        await manager.save(doc);

        // 批量创建分块
        const chunkEntities = chunks.map(chunk =>
          manager.create(DocumentChunk, {
            documentId: doc.id,
            chunkIndex: chunk.index,
            content: chunk.content,
            embedding: chunk.embedding,
            metadata: chunk.metadata,
          }),
        );
        await manager.save(chunkEntities);

        return { documentId: doc.id, chunkCount: chunks.length };
      },
    );

    return result;
  }
}
```

## pgvector 存储

向量字段使用 pgvector 扩展：

```typescript
@Column({
  type: 'vector',
  dimension: 1536,
})
embedding: number[];
```

确保数据库已安装 pgvector 扩展：

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

## 错误处理

- **事务失败**：自动回滚，返回错误信息
- **向量格式错误**：验证向量维度
- **外键约束**：确保文档存在后再创建分块
