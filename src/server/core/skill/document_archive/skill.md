---
name: 文档归档与检索
description: Archive web pages and emails to vector database with metadata extraction, chunking, and embeddings. Use when user wants to save, archive, or store web content or emails for later retrieval, or mentions archiving documents, saving links, or building a knowledge base.
---

## 邮件归档工作流

归档邮件时，先理解内容并让用户确认归档方式：

### Step 0: 理解内容并确认

先阅读邮件内容，然后调用 `ask_user` 让用户选择归档方式：

- 展示邮件摘要（发件人、主题、内容概要）
- 使用 `formSchema` 提供选项：
  ```json
  {
    "type": "object",
    "properties": {
      "action": {
        "type": "string",
        "enum": [
          { "label": "归档邮件全文", "value": "archive_email" },
          { "label": "提取链接批量归档", "value": "archive_links" },
          { "label": "取消", "value": "cancel" }
        ],
        "title": "请选择归档方式"
      }
    }
  }
  ```

根据用户选择执行后续步骤：

- **archive_email**: 直接对邮件内容执行下方 4 步归档流程
- **archive_links**: 调用 `links_extract` 提取链接 → `ask_user` 多选确认 → 对每个选中链接执行 `web_fetch` + 4 步归档
- **cancel**: 返回 `final_answer` 取消

## 网页归档工作流

归档网页时，先展示内容概要并确认：

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

## 归档管线

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
