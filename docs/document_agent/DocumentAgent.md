# DocumentAgent 设计

## 概述

DocumentAgent 是文档归档系统的主控 Agent，继承自 ReActAgent，持有多个工具协同完成文档的获取、归档和检索。

## 职责

- 理解用户意图，决定执行哪个工具
- 协调工具间的数据流转
- 处理异常和重试逻辑
- 向用户报告执行进度

## 工具清单

| 工具         | 用途              | 输入              | 输出           |
| ------------ | ----------------- | ----------------- | -------------- |
| WebFetchTool | 获取网页/文件内容 | URL / 文件路径    | 文档内容       |
| AnalysisTool | 归档 Pipeline     | 文档内容 + 元信息 | 文档 ID        |
| RetrieveTool | 语义检索          | 查询文本          | 相关文档块列表 |

## 典型交互流程

### 归档网页

```
用户: 把这篇文档归档 https://example.com/article

DocumentAgent 思考:
  1. 需要先获取内容 → WebFetchTool
  2. 内容已获取，执行归档 → AnalysisTool

结果: 文档已归档，ID: xxx
```

### 批量归档

```
用户: 批量归档这些链接：
      https://a.com/1
      https://b.com/2
      https://c.com/3

DocumentAgent 思考:
  1. 并发获取所有内容 → 多个 WebFetchTool 调用
  2. 逐个执行归档 → AnalysisTool（可并发）

结果: 3 篇文档已归档
```

### 语义检索

```
用户: 找关于 React 性能优化的文章

DocumentAgent 思考:
  1. 这是检索请求 → RetrieveTool

结果: 返回相关文档块列表
```

## 错误处理

- **获取失败**：记录失败 URL，继续处理其他任务，最后汇总报告
- **分析失败**：支持重试，重试次数可配置
- **存储失败**：事务回滚，保证数据一致性

## 扩展性

后续可扩展：

- **FileReadTool**：读取本地文件
- **BatchAnalysisTool**：批量归档优化
- **队列化**：将长时间任务放入后台队列
