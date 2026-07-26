---
name: 文档归档与检索
description: Archive web pages and emails to vector database with metadata extraction, chunking, and embeddings. Use when user wants to save, archive, or store web content or emails for later retrieval, or mentions archiving documents, saving links, or building a knowledge base.
---

## 关键规则

1. **rawContent / rawFile 必须指向完整原文**，绝不能是摘要、链接简介、或模型自己概括的文字。邮件内容归档时原文即邮件全文；网页归档时原文即 web_fetch 返回的内容。
2. **每条链接是独立文档**。从邮件提取多个链接时，每个链接单独执行 web_fetch → 归档管线，各自存入一条 Document 记录。不要把多个链接的内容混淆到一起。
3. **大内容用 rawFile 透传文件名，不要把原文搬回上下文**。当一条 web_fetch/email 的 Observation 已被系统落盘（你会看到 `[offloaded to file <文件名>]` 的桩），直接把那个**文件名**作为工具入参的 `rawFile` 字段传入（`document_metadata_extract` 和 `document_store` 都支持 `rawFile`），**不要**用 bash `cat`/`rg` 把原文读回上下文。仅当内容很短、本就在上下文里时才用 `content`/`rawContent` 传完整字符串。

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
- **archive_links**: 调用 `links_extract` 提取链接 → 筛选：侧重文章、教程、深度内容类链接，排除推广、版本发布通知、产品更新等轻量链接 → `ask_user` 多选确认要归档哪些链接 → 按下文「批量归档（多链接并发）」用 `call_subagents` 并发归档每个选中链接
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

给定一段内容（完整原文字符串，或一个落盘文件名 `rawFile`），按以下步骤依次调用工具完成归档。**若 web_fetch 的 Observation 已落盘（看到 `[offloaded to file <文件名>]`），优先把文件名作为 `rawFile` 透传，不要把原文搬回上下文。**

### Step 1: 提取元数据

调用 `document_metadata_extract`：

- input: `{ "content": "<完整原文>", "rawFile": "<落盘文件名，二选一>", "sourceUrl": "<来源URL>", "sourceType": "<web|email|text>" }`
- output: `{ title, summary, keywords, category, metadata }`

### Step 2: 存储到数据库

调用 `document_store`（分块与向量都在工具内部自动完成——内部依次调用 `content_chunk` 切分、`embedding_generate` 生成向量；调用方只传 `document`，无需、也不应传入 chunks 或 embeddings）：

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
      "rawFile": "<落盘文件名；若内容短则在 rawContent 传完整原文字符串>"
    }
  }
  ```
- output: `{ documentId, chunkCount }`

## 批量归档（多链接并发）

当要归档**多个链接**时，使用 `call_subagents` 并发处理——每个链接派一个子 agent，各自独立完成 `web_fetch` → 归档管线（避免单循环处理多链接时的上下文混淆/部分失败）。

一次 `call_subagents` 调用，`children` 为每个选中链接一项：

- `brief`：把「归档管线（上述 Step 1–2）」+「关键规则（rawContent/rawFile 指向完整原文、大内容用 `rawFile` 透传文件名不搬回上下文、每条链接是独立文档等）」作为背景传给子 agent。
- `query`：`归档此链接：<url>（sourceType = "web"）`。

`call_subagents` 等全部子 agent 结束（allSettled）后返回各自结果；据此向用户汇总（成功 X 条、失败 Y 条及原因）。**单个链接无需子 agent**，直接执行管线即可。
