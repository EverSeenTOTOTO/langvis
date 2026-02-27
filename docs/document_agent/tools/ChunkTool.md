# ChunkTool

## 概述

ChunkTool 负责将文档内容切分为多个块，采用策略模式支持不同的分块算法。

## 职责

- 根据策略切分文档
- 保留块的上下文信息
- 支持扩展新的分块策略

## 输入

```typescript
interface ChunkInput {
  content: string; // 文档内容
  strategy?: 'paragraph' | 'fixed' | 'semantic'; // 分块策略，默认 paragraph
  options?: {
    maxChunkSize?: number; // 最大块大小（字符数）
    overlap?: number; // 块重叠字符数
  };
}
```

## 输出

```typescript
interface ChunkOutput {
  chunks: Array<{
    content: string; // 块内容
    index: number; // 块序号
    metadata?: Record<string, unknown>; // 块元信息
  }>;
}
```

## 分块策略

### paragraph（段落分块）

按段落边界切分，保持语义完整性。

```
文档内容
    │
    ▼ 按换行符分段
段落列表
    │
    ▼ 合并过短段落
最终分块
```

**适用场景**：大多数文档，语义完整性好。

### fixed（固定窗口）

按固定字符数切分，支持重叠。

```
文档内容
    │
    ▼ 按 maxChunkSize 切分
固定大小块
    │
    ▼ 添加 overlap
最终分块
```

**适用场景**：对语义完整性要求不高的场景，或作为兜底策略。

### semantic（语义分块）

使用 embedding 计算段落相似度，在语义边界处切分。

**适用场景**：高质量检索需求。

**实现优先级**：先实现 paragraph 和 fixed，semantic 作为后续扩展。

## 实现要点

```typescript
interface ChunkStrategy {
  name: string;
  chunk(content: string, options?: ChunkOptions): ChunkOutput;
}

class ParagraphStrategy implements ChunkStrategy {
  name = 'paragraph';
  chunk(content: string, options?: ChunkOptions): ChunkOutput {
    // 1. 按双换行符分段
    // 2. 合并过短段落
    // 3. 返回分块结果
  }
}

class FixedStrategy implements ChunkStrategy {
  name = 'fixed';
  chunk(content: string, options?: ChunkOptions): ChunkOutput {
    // 1. 按 maxChunkSize 切分
    // 2. 添加 overlap
    // 3. 返回分块结果
  }
}

class ChunkTool {
  private strategies: Map<string, ChunkStrategy>;

  execute(input: ChunkInput): ChunkOutput {
    const strategy = this.strategies.get(input.strategy || 'paragraph');
    return strategy.chunk(input.content, input.options);
  }
}
```

## 扩展性

新增策略只需实现 `ChunkStrategy` 接口并注册：

```typescript
chunkTool.registerStrategy(new SemanticStrategy());
```
