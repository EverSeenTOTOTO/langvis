# EmbedTool

## 概述

EmbedTool 负责将文档块向量化，调用 embedding API 生成向量。

## 职责

- 调用 embedding API
- 处理批量请求
- 管理向量维度配置

## 输入

```typescript
interface EmbedInput {
  chunks: Array<{
    content: string;
    index: number;
    metadata?: Record<string, unknown>;
  }>;
  model?: string; // embedding 模型，默认 text-embedding-ada-002
}
```

## 输出

```typescript
interface EmbedOutput {
  chunks: Array<{
    content: string;
    index: number;
    embedding: number[]; // 向量
    metadata?: Record<string, unknown>;
  }>;
  model: string; // 使用的模型
  dimension: number; // 向量维度
}
```

## API 配置

使用环境变量配置，与 TTS 工具保持一致：

| 环境变量          | 说明         |
| ----------------- | ------------ |
| `OPENAI_API_BASE` | API 基础地址 |
| `OPENAI_API_KEY`  | Bearer Token |

**请求示例**：

```typescript
const apiBase = process.env.OPENAI_API_BASE;
const apiKey = process.env.OPENAI_API_KEY;

const url = `${apiBase}/v1/embeddings`;

const response = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'text-embedding-ada-002',
    input: ['文本1', '文本2'],
  }),
});
```

**返回示例**：

```json
{
  "object": "list",
  "data": [
    {
      "object": "embedding",
      "embedding": [0.0023064255, -0.009327292, ...],
      "index": 0
    }
  ],
  "model": "text-embedding-ada-002",
  "usage": {
    "prompt_tokens": 8,
    "total_tokens": 8
  }
}
```

## 支持的模型

| 模型                   | 维度 | 说明           |
| ---------------------- | ---- | -------------- |
| text-embedding-ada-002 | 1536 | 默认，兼容性好 |

## 批量处理

API 支持批量请求，`input` 可以是字符串数组：

```typescript
const texts = chunks.map(c => c.content);

const response = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: 'text-embedding-ada-002',
    input: texts,
  }),
});

const result = await response.json();

// 按 index 排序确保顺序正确
const sortedData = result.data.sort((a, b) => a.index - b.index);

// 合并结果
const embeddedChunks = chunks.map((chunk, i) => ({
  ...chunk,
  embedding: sortedData[i].embedding,
}));
```

## 实现要点

```typescript
@tool(ToolIds.EMBED)
export default class EmbedTool extends Tool<EmbedInput, EmbedOutput> {
  async *call(
    @input() params: EmbedInput,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, EmbedOutput, void> {
    const { chunks, model = 'text-embedding-ada-002' } = params;

    const apiBase = process.env.OPENAI_API_BASE;
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiBase || !apiKey) {
      throw new Error('OPENAI_API_BASE and OPENAI_API_KEY must be configured');
    }

    const url = `${apiBase}/v1/embeddings`;
    const texts = chunks.map(c => c.content);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ model, input: texts }),
      signal: ctx.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Embedding API failed: ${response.status} - ${text}`);
    }

    const result = await response.json();
    const sortedData = result.data.sort((a, b) => a.index - b.index);

    const output: EmbedOutput = {
      chunks: chunks.map((chunk, i) => ({
        ...chunk,
        embedding: sortedData[i].embedding,
      })),
      model,
      dimension: sortedData[0].embedding.length,
    };

    return output;
  }
}
```

## 错误处理

- **API 限流**：指数退避重试
- **超长内容**：截断或拆分
- **配置缺失**：返回明确错误信息
