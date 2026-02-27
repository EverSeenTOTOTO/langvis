# RetrieveTool

## 概述

RetrieveTool 负责语义检索，根据查询文本返回相关的文档块。

## 职责

- 将查询文本向量化
- 执行向量相似度搜索
- 返回相关文档块及其来源文档信息

## 输入

```typescript
interface RetrieveInput {
  query: string; // 查询文本
  limit?: number; // 返回数量，默认 10
  threshold?: number; // 相似度阈值（0-1），默认不过滤
}
```

## 输出

```typescript
interface RetrieveOutput {
  results: Array<{
    chunkId: string;
    content: string; // 块内容
    similarity: number; // 相似度分数
    document: {
      id: string;
      title: string;
      category: string;
      sourceUrl?: string;
    };
  }>;
}
```

## 检索流程

```
查询文本
    │
    ▼ EmbedTool（复用）
查询向量
    │
    ▼ pgvector 相似度搜索
相关文档块
    │
    ▼ 关联查询文档信息
返回结果
```

## 实现要点

```typescript
@tool(ToolIds.RETRIEVE)
export default class RetrieveTool extends Tool<RetrieveInput, RetrieveOutput> {
  constructor(
    private embedTool: EmbedTool,
    private chunkRepo: Repository<DocumentChunk>,
  ) {
    super();
  }

  async *call(
    @input() params: RetrieveInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<ToolEvent, RetrieveOutput, void> {
    const { query, limit = 10, threshold } = params;

    // 复用 EmbedTool 向量化查询
    const embedResult = await this.embedTool.execute({
      chunks: [{ content: query, index: 0 }],
    });
    const queryVector = embedResult.chunks[0].embedding;

    // pgvector 相似度搜索
    const results = await this.chunkRepo
      .createQueryBuilder('chunk')
      .leftJoinAndSelect('chunk.document', 'document')
      .orderBy('chunk.embedding <=> :vector', 'DESC') // 余弦距离
      .setParameters({ vector: `[${queryVector.join(',')}]` })
      .limit(limit)
      .getMany();

    // 过滤阈值
    const filtered = threshold
      ? results.filter(r => {
          // 计算相似度 = 1 - 距离
          const similarity = 1 - r.distance;
          return similarity >= threshold;
        })
      : results;

    const output: RetrieveOutput = {
      results: filtered.map(chunk => ({
        chunkId: chunk.id,
        content: chunk.content,
        similarity: 1 - chunk.distance,
        document: {
          id: chunk.document.id,
          title: chunk.document.title,
          category: chunk.document.category,
          sourceUrl: chunk.document.sourceUrl,
        },
      })),
    };

    yield ctx.toolResultEvent(this.id, output);
    return output;
  }
}
```

## pgvector 距离运算符

| 运算符 | 说明         | 适用场景             |
| ------ | ------------ | -------------------- |
| `<=>`  | 余弦距离     | 默认，适合大多数场景 |
| `<->`  | 欧几里得距离 | 维度差异较大的场景   |
| `<#>`  | 内积         | 归一化向量           |

余弦距离：值越小越相似，相似度 = 1 - 距离

## 性能优化

- **索引**：为向量字段创建索引

```sql
CREATE INDEX ON document_chunks USING ivfflat (embedding vector_cosine_ops);
```

- **预过滤**：结合元数据过滤减少搜索范围
- **缓存**：高频查询结果缓存
