# Document Agent 文档体系

## 概述

Document Agent 是一个自动化文档归档与检索系统，核心目标是建立可检索的知识库。

**设计理念**：让 AI 像人类图书管理员一样处理文档 — 获取 → 分析 → 归档 → 检索。

## 核心能力

- **文档获取**：支持 URL、本地文件等多种来源
- **元信息提取**：一次 LLM 调用提取标题、关键词、摘要、分类及动态元信息
- **智能分块**：策略模式，可扩展
- **向量化存储**：基于 pgvector，支持语义检索
- **语义检索**：根据查询返回相关文档内容块

## 架构一览

```
DocumentAgent（继承 ReActAgent）
    │
    ├─ WebFetchTool       — 获取网页/文件内容
    │
    ├─ AnalysisTool       — 归档 Pipeline（组合工具）
    │     └─ 内部 resolve 调用：
    │           ├─ MetaExtractTool  — 提取元信息
    │           ├─ ChunkTool        — 分块
    │           ├─ EmbedTool        — 向量化
    │           └─ ArchiveTool      — 存储
    │
    └─ RetrieveTool       — 语义检索
```

## 文档索引

| 文档                                   | 说明          |
| -------------------------------------- | ------------- |
| [data-model.md](./data-model.md)       | 数据模型设计  |
| [DocumentAgent.md](./DocumentAgent.md) | 主 Agent 设计 |
| [tools/](./tools/)                     | 工具详细设计  |

## 典型流程

### 单篇归档

```
URL → WebFetchTool → AnalysisTool → 归档完成
```

### 批量采集

```
URL[] → 并发 WebFetchTool → 逐个 AnalysisTool → 全部归档
```

### 语义检索

```
查询 → RetrieveTool → 相关文档块列表
```
