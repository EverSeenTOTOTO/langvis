# MetaExtractTool

## 概述

MetaExtractTool 负责从文档内容中提取元信息，通过一次 LLM 调用完成。

## 职责

- 提取文档标题
- 生成一句话摘要
- 提取关键词
- 判断文档分类
- 根据分类提取动态元信息

## 输入

```typescript
interface MetaExtractInput {
  content: string; // 文档内容
  sourceUrl?: string; // 来源 URL（辅助判断）
  sourceType?: string; // 来源类型
}
```

## 输出

```typescript
interface MetaExtractOutput {
  title: string; // 文档标题
  summary: string; // 一句话摘要
  keywords: string[]; // 关键词列表
  category: string; // 分类
  metadata: Record<string, unknown>; // 动态元信息
}
```

## 分类体系

预定义的分类及对应元信息：

| 分类          | 说明     | 动态元信息                    |
| ------------- | -------- | ----------------------------- |
| tech_blog     | 技术博客 | platform, techStack           |
| social_media  | 社交媒体 | platform, author, publishedAt |
| paper         | 学术论文 | authors, venue, year          |
| documentation | 技术文档 | library, version              |
| news          | 新闻资讯 | source, publishedAt, region   |
| other         | 其他     | -                             |

## Prompt 设计

通过结构化 Prompt 引导 LLM 输出 JSON：

```
你是一个文档分析助手。请分析以下文档内容，提取元信息。

文档内容：
{content}

请输出以下 JSON 格式：
{
  "title": "文档标题",
  "summary": "一句话摘要（不超过 50 字）",
  "keywords": ["关键词1", "关键词2", "关键词3"],
  "category": "分类（tech_blog/social_media/paper/documentation/news/other）",
  "metadata": {
    // 根据分类提取对应字段
  }
}
```

## 实现要点

- 内容过长时截断，保留关键部分
- 使用 JSON Schema 约束输出格式
- 解析失败时提供默认值
- 分类不确定时归为 other
