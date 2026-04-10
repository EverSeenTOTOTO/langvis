---
name: 文档归档与检索
description: 将网页/邮件内容归档到数据库（元数据提取→分块→向量化→存储）及语义检索
---

## 归档工作流

给定一段内容（网页、邮件、文本），按以下 4 步依次调用工具完成归档：

### Step 1: 提取元数据

调用 `document_metadata_extract`：

- input: `{ "content": "<原文>", "sourceUrl": "<来源URL，可选>", "sourceType": "<web|email|text>" }`
- output: `{ title, summary, keywords, category, metadata }`

### Step 2: 内容分块

调用 `content_chunk`：

- input: `{ "content": "<原文>", "strategy": "paragraph", "options": { "maxChunkSize": 1000 } }`
- output: `{ chunks: [{ content, index, metadata? }] }`

### Step 3: 生成向量

调用 `embedding_generate`：

- input: `{ "chunks": <Step 2 的 chunks 输出> }`
- output: `{ chunks: [{ content, index, embedding, metadata? }], model, dimension }`

### Step 4: 存储到数据库

调用 `document_store`：

- input:
  ```json
  {
    "document": {
      "title": "<Step1.title>",
      "summary": "<Step1.summary>",
      "keywords": "<Step1.keywords>",
      "category": "<Step1.category>",
      "metadata": "<Step1.metadata>",
      "sourceUrl": "<来源URL>",
      "sourceType": "<来源类型>",
      "rawContent": "<原文>"
    },
    "chunks": "<Step3 的 chunks 输出>"
  }
  ```
- output: `{ documentId, chunkCount }`

## 批量归档

对多个 URL 逐个执行：`web_fetch` 获取内容 → 上述 4 步归档流程。

## 语义检索

直接调用 `document_search`，传入自然语言查询即可。
