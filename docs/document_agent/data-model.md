# 数据模型设计

## 概述

文档归档系统需要两张核心表：`documents` 存储文档元数据，`document_chunks` 存储分块内容和向量。

## 表结构

### documents 表

文档元数据表，存储文档的基础信息和分类相关动态元信息。

```typescript
@Entity('documents')
class Document {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // 基础信息
  @Column()
  title: string; // 文档标题

  @Column({ type: 'text', nullable: true })
  summary: string; // 一句话摘要

  @Column({ type: 'simple-array' })
  keywords: string[]; // 关键词列表

  @Column()
  category: string; // 分类：tech_blog / social_media / paper / ...

  // 来源信息
  @Column({ nullable: true })
  sourceUrl: string; // 原始 URL

  @Column({ nullable: true })
  sourceType: string; // 来源类型：web / file / ...

  @Column({ type: 'text' })
  rawContent: string; // 原始内容（用于重新分块）

  // 动态元信息（JSON，根据分类存储不同字段）
  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown>;

  // 示例：
  // tech_blog: { platform: '掘金', techStack: ['React', 'TypeScript'] }
  // social_media: { platform: 'Twitter', author: '@user', publishedAt: '2024-01-01' }

  // 时间戳
  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
```

### document_chunks 表

文档分块表，存储每个块的内容和向量。

```typescript
@Entity('document_chunks')
class DocumentChunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  documentId: string; // 关联文档 ID

  @Column()
  chunkIndex: number; // 块序号（从 0 开始）

  @Column({ type: 'text' })
  content: string; // 块内容

  @Column({
    type: 'vector',
    dimension: 1536, // OpenAI text-embedding-3-small 维度
    nullable: true,
  })
  embedding: number[]; // 向量

  @Column({ type: 'jsonb', nullable: true })
  metadata: Record<string, unknown>; // 块级元信息（如章节标题）

  @CreateDateColumn()
  createdAt: Date;

  // 关联
  @ManyToOne(() => Document)
  document: Document;
}
```

## 分类与动态元信息

不同分类的文档提取不同的元信息：

| 分类          | 额外元信息                                                    |
| ------------- | ------------------------------------------------------------- |
| tech_blog     | platform（发布平台）、techStack（技术范畴）                   |
| social_media  | platform（来源平台）、author（作者）、publishedAt（发布时间） |
| paper         | authors、venue（会议/期刊）、year                             |
| documentation | version、library                                              |
| news          | source、publishedAt、region                                   |

## 检索模式

### 元数据检索（CRUD）

通过 DocumentService 提供标准 CRUD 接口：

- 按分类筛选
- 按关键词筛选
- 按时间范围筛选
- 分页浏览

### 语义检索（向量）

通过 pgvector 的向量相似度查询：

```sql
SELECT dc.*, d.title, d.category
FROM document_chunks dc
JOIN documents d ON dc.document_id = d.id
ORDER BY dc.embedding <=> :queryVector
LIMIT :limit;
```

`<=>` 是 pgvector 的余弦距离运算符。
