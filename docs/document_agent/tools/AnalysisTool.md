# AnalysisTool

## 概述

AnalysisTool 是文档归档的核心 Pipeline 工具，内部组合多个子工具完成完整的归档流程。

## 职责

- 组织归档流程的执行顺序
- 处理工具间的数据流转
- 管理事务一致性
- 支持失败重试

## 输入

```typescript
interface AnalysisInput {
  content: string; // 文档内容
  sourceUrl?: string; // 来源 URL
  sourceType: 'web' | 'file' | 'text'; // 来源类型
  metadata?: Record<string, unknown>; // 额外元信息
}
```

## 输出

```typescript
interface AnalysisOutput {
  documentId: string; // 归档后的文档 ID
  title: string; // 提取的标题
  category: string; // 分类
  chunkCount: number; // 分块数量
}
```

## 内部工具链

AnalysisTool 通过 resolve 调用以下子工具：

```
AnalysisTool
    │
    ├─→ MetaExtractTool   — 提取元信息
    │
    ├─→ ChunkTool         — 分块
    │
    ├─→ EmbedTool         — 向量化
    │
    └─→ ArchiveTool       — 存储
```

## 执行流程

```
输入文档内容
    │
    ▼
MetaExtractTool
    │ 输出: { title, summary, keywords, category, metadata }
    │
    ▼
ChunkTool
    │ 输出: { chunks: [{ content, index }] }
    │
    ▼
EmbedTool
    │ 输出: { chunks: [{ content, index, embedding }] }
    │
    ▼
ArchiveTool
    │ 输出: { documentId }
    │
    ▼
返回结果
```

## 事务管理

- ArchiveTool 负责事务管理，保证文档和分块的原子性写入
- 失败时整体回滚，不产生脏数据

## 独立调用

每个子工具都支持独立调用，便于调试和测试：

```typescript
// 单独测试元信息提取
const meta = await metaExtractTool.execute({ content: '...' });

// 单独测试分块
const chunks = await chunkTool.execute({ content: '...' });

// 单独测试向量化
const embedded = await embedTool.execute({ chunks: [...] });
```
