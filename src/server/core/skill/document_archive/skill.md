---
name: 文档归档与检索
description: Archive web pages and emails to vector database with metadata extraction, chunking, and embeddings. Use when user wants to save, archive, or store web content or emails for later retrieval, or mentions archiving documents, saving links, or building a knowledge base.
---

## 关键规则

1. **rawContent 必须是完整原文**，绝不能是摘要、链接简介、或模型自己概括的文字。邮件归档时 rawContent = 邮件全文；网页归档时 rawContent = web_fetch 返回的完整 content。
2. **每条链接是独立文档**。从邮件提取多个链接时，每个链接单独执行 web_fetch → 归档管线，各自存入一条 Document 记录。不要把多个链接的内容合并到同一条 Document。
3. **利用缓存传递原文**。web_fetch 等工具返回大量内容时会被缓存为 `{ "$cached": "...", "$size": ..., "$preview": "..." }` 格式。后续工具（content_chunk、document_metadata_extract、document_store 等）需要原文作为入参时，直接传入该 `$cached` 对象，系统会自动解析为完整内容，无需手动展开或概括。

## 入口判断

根据用户提供的来源类型，进入对应工作流：

- 用户提供了 URL → **网页归档**（直接 web_fetch 获取内容）
- 用户提供了邮件内容 → **邮件归档**（先确认归档方式）

## 邮件归档工作流

### Step 0: 理解内容并确认

阅读邮件内容，调用 `ask_user` 让用户选择归档方式：

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        { "label": "归档邮件全文", "value": "archive_email" },
        { "label": "提取链接逐个归档", "value": "archive_links" },
        { "label": "取消", "value": "cancel" }
      ],
      "title": "请选择归档方式"
    }
  }
}
```

根据用户选择：

- **archive_email**: 邮件原文作为 content，sourceType = "email"，直接执行下方「归档管线」
- **archive_links**: 调用 `links_extract` 提取链接 → 筛选：侧重文章、教程、深度内容类链接，排除推广、版本发布通知、产品更新等轻量链接 → `ask_user` 多选确认要归档哪些链接 → 对每个选中链接，逐个执行：`web_fetch` 获取网页内容 → 以网页内容作为 content、sourceType = "web" → 执行「归档管线」。注意：此时 rawContent = web_fetch 返回的完整网页内容，不是邮件中的链接简介文字。
- **cancel**: 返回 `final_answer` 取消

## 网页归档工作流

### Step 0: 确认归档

调用 `ask_user` 让用户确认：

```json
{
  "type": "object",
  "properties": {
    "action": {
      "type": "string",
      "enum": [
        { "label": "确认归档", "value": "archive" },
        { "label": "取消", "value": "cancel" }
      ],
      "title": "确认归档此网页？"
    }
  }
}
```

确认后，调用 `web_fetch` 获取网页完整内容，以该内容作为 content、sourceType = "web"，执行下方「归档管线」。

## 归档管线

给定一段完整原文内容，按以下 4 步依次调用工具完成归档：

### Step 1: 提取元数据

调用 `document_metadata_extract`：

- input: `{ "content": "<完整原文>", "sourceUrl": "<来源URL>", "sourceType": "<web|email|text>" }`
- output: `{ title, summary, keywords, category, metadata }`

### Step 2: 内容分块

调用 `content_chunk`：

- input: `{ "content": "<完整原文>", "strategy": "paragraph", "options": { "maxChunkSize": 1000 } }`
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
      "rawContent": "<完整原文，非摘要>"
    },
    "chunks": "<Step3 的 chunks 输出>"
  }
  ```
- output: `{ documentId, chunkCount }`

## 批量归档注意事项

对多个 URL 逐个执行：`web_fetch` → 归档管线。每个 URL 产生一条独立的 Document 记录。由于暂时没有并发机制，必须挨个处理。
