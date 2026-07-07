---
name: 文档归档与检索
description: Archive web pages and emails to vector database with metadata extraction, chunking, and embeddings. Use when user wants to save, archive, or store web content or emails for later retrieval, or mentions archiving documents, saving links, or building a knowledge base.
---

## 关键规则

1. **rawContent 必须是完整原文**，绝不能是摘要、链接简介、或模型自己概括的文字。邮件内容归档时 rawContent = 那件全文；网页归档时 rawContent = web_fetch 返回的内容（可能是 `$cached` 引用 — 直接透传即可，系统会自动解析）。
2. **每条链接是独立文档**。从邮件提取多个链接时，每个链接单独执行 web_fetch → 归档管线，各自存入一条 Document 记录。不要把多个链接的内容混淆到一起。
3. **尽量透传缓存，避免读取原文**。归档管线中，`content`、`rawContent` 等需要完整原文的参数，直接传入 `$cached` 引用对象即可，系统会在工具调用前自动 resolve 为完整内容。非必要不加载完整原文。

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

给定一段内容（可能是完整原文字符串，也可能是 `$cached` 引用），按以下步骤依次调用工具完成归档。

### Step 1: 提取元数据

调用 `document_metadata_extract`：

- input: `{ "content": "<原文或$cached引用>", "sourceUrl": "<来源URL>", "sourceType": "<web|email|text>" }`
- output: `{ title, summary, keywords, category, metadata }`

### Step 2: 内容分块

调用 `content_chunk`：

- input: `{ "content": "<原文或$cached引用>", "strategy": "paragraph", "options": { "maxChunkSize": 1000 } }`
- output: `{ chunks: [{ content, index, metadata? }] }`

注意：maxChunkSize 不要随意调大，最多 2000。

### Step 3: 生成向量

**如果 chunks ≤ 32**，一次调用 `embedding_generate`：

- input: `{ "chunks": <Step 2 输出的 .chunks 数组> }`
- output: `{ embeddings: [[...], ...], model, dimension }`（向量与输入 chunks 同序；**不含 content**——content 由 Step 2 持有，避免原文回流进 observation 拖慢后续步骤）

**如果 chunks > 32**，分批调用 `embedding_generate`，每批最多 32 个 chunks：

- 将 Step 2 的 chunks 按顺序分成多批，每批 ≤ 32 个
- 对每批调用 `embedding_generate`：`{ "chunks": <该批 .chunks 数组> }`
- 收集所有批次的输出，将各批 `embeddings` 按顺序拼接为一个完整数组
- 最终合并结果：`{ embeddings: [[...], ...], model, dimension }`

### Step 4: 存储到数据库

调用 `document_store`（content 来自 Step 2、向量来自 Step 3，两者同序、按位对齐，长度必须相等）：

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
      "rawContent": "<原文或$cached引用>"
    },
    "chunks": "<Step 2 输出的 .chunks 数组>",
    "embeddings": "<Step 3 输出的 .embeddings 数组>"
  }
  ```
- output: `{ documentId, chunkCount }`

## 批量归档（多链接并发）

当要归档**多个链接**时，使用 `call_subagents` 并发处理——每个链接派一个子 agent，各自独立完成 `web_fetch` → 归档管线（避免单循环处理多链接时的上下文混淆/部分失败）。

一次 `call_subagents` 调用，`children` 为每个选中链接一项：

- `brief`：把「归档管线（上述 Step 1–4）」+「关键规则（rawContent 必须是完整原文、尽量透传 `$cached`、每条链接是独立文档等）」作为背景传给子 agent。
- `query`：`归档此链接：<url>（sourceType = "web"）`。

`call_subagents` 等全部子 agent 结束（allSettled）后返回各自结果；据此向用户汇总（成功 X 条、失败 Y 条及原因）。**单个链接无需子 agent**，直接执行管线即可。
