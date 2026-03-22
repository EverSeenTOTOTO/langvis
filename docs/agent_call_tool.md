# AgentCallTool 设计文档

## 概述

AgentCallTool 是一个元工具（Meta Tool），允许一个 Agent 调用另一个 Agent 作为子任务。这使得 ReActAgent 可以编排多个专业 Agent，实现分层推理工作流。

## 动机

当前架构中，ReActAgent 通过调用 Tool 扩展能力，但某些任务本身就需要 Agent 级别的多步骤推理，例如：

- 文档分析（分类→关键词→概要→引申）
- 代码审查（读取→分析→生成建议→验证）
- 数据处理（解析→转换→验证→存储）

如果把这些逻辑塞进单个 Tool，会失去：

1. 独立的可观测性
2. 复用性（其他 Agent 也想调用同一能力）

## 架构

```
ParentAgent (ReAct)
    ├── tool_call: agent_call (agentId: "document")
    │   │
    │   ├── tool_progress: { status: "agent_event", event: { type: "tool_call", ... }}
    │   │   └── tool_progress: { status: "agent_event", event: { type: "tool_progress", ... }}
    │   │       └── ... nested child events
    │   │
    │   └── tool_result: { success: true, content: "..." }
    │
    └── tool_call: ask_user (awaiting input)
```

## 设计原则

### 嵌套事件透传

子 Agent 的事件通过 `tool_progress` 包装后透传给前端，保留完整的执行细节。前端通过展开查看子 Agent 的工具调用、思考和用户交互。

### 分层推理

每层 Agent 调用处理更小、更具体的子问题，形成类似函数调用栈的推理层次。

## 接口设计

### 输入

```typescript
interface AgentCallInput {
  agentId: string;
  query: string; // 父 Agent 转述给子 Agent 的用户诉求
  config?: {
    timeout?: number; // 默认 60000ms
  };
}
```

`query` 字段用于父 Agent 将当前用户的诉求转述给子 Agent，使子 Agent 明确其任务目标。

### 输出

### 输出

```typescript
interface AgentCallOutput {
  success: boolean;
  content?: string; // 子 Agent 累积的最终内容
  error?: string;
}
```

### 嵌套事件包装

子 Agent 的每个事件通过 `tool_progress` 包装：

```typescript
{
  status: 'agent_event';
  event: AgentEvent;
}
```

### Agent 配置

Agent 通过 config 注册可调用的子 Agent，与 tools 类似：

```typescript
// ReActAgent config.ts
export const config: AgentConfig = {
  extends: AgentIds.CHAT,
  name: 'ReAct Agent',
  description: '...',
  tools: [ToolIds.DATE_TIME, ToolIds.WEB_FETCH, ToolIds.AGENT_CALL],
  agents: [AgentIds.DOCUMENT_ANALYSIS, AgentIds.DOCUMENT_CONCLUDE],
};
```

ReAct Agent 在生成 system prompt 时，将注册的 agents 格式化到工具描述中，告知 LLM 可用 Agent 及其能力。

## 事件处理策略

AgentCallTool 执行子 Agent 时，将子 Agent 的每个事件包装后 yield：

| 子 Agent 事件              | 处理方式                                                           |
| -------------------------- | ------------------------------------------------------------------ |
| `start`                    | yield progress: `{ status: 'agent_event', event }`                 |
| `thought`                  | yield progress: `{ status: 'agent_event', event }`                 |
| `tool_call`                | yield progress: `{ status: 'agent_event', event }`                 |
| `tool_progress`            | yield progress: `{ status: 'agent_event', event }`                 |
| `tool_result`/`tool_error` | yield progress: `{ status: 'agent_event', event }`                 |
| `stream`                   | 累积到 `content`，同时 yield progress: `{ status: 'agent_event' }` |
| `final`                    | yield progress: `{ status: 'agent_event', event }`，结束循环       |
| `error`                    | yield progress: `{ status: 'agent_event', event }`，结束循环       |

事件序列示例：

```
tool_call: { callId: "tc_1", toolName: "agent_call", toolArgs: { agentId: "document", query: "分析这篇文章的核心观点" } }
tool_progress: { callId: "tc_1", data: { status: "agent_event", event: { type: "start", ... } } }
tool_progress: { callId: "tc_1", data: { status: "agent_event", event: { type: "tool_call", callId: "tc_1::tc_2", ... } } }
tool_progress: { callId: "tc_1", data: { status: "agent_event", event: { type: "tool_result", callId: "tc_1::tc_2", ... } } }
tool_progress: { callId: "tc_1", data: { status: "agent_event", event: { type: "final", ... } } }
tool_result: { callId: "tc_1", output: { success: true, content: "分析结果..." } }
```

## CallId 层级命名

子 Agent 生成的 callId 采用层级命名，格式为 `父callId::子callId`：

```
tc_1                    // 父 agent_call 的 callId
tc_1::tc_2              // 子 Agent 的第一个工具调用
tc_1::tc_3              // 子 Agent 的第二个工具调用
tc_1::tc_3::tc_4        // 孙 Agent 的工具调用（多层嵌套）
```

前端可通过 `callId` 的 `::` 分隔符重建调用层级。

## 子上下文创建

AgentCallTool 创建子 ExecutionContext：

- **独立的 AbortController** - 子上下文有自己的超时控制
- **级联取消** - 父上下文取消时，自动取消子上下文
- **callId 前缀** - 子上下文生成的 callId 自动添加父 callId 前缀

## 前端展示

### 混合展开模式

子 Agent 在父 Agent 的时间线中显示为可展开块：

```
Parent Agent Timeline:
├── Tool: web_fetch ✓
├── Agent: DocumentAgent ▶  <-- collapsed
│   └── [expanded view]
│       ├── Tool: chunk ✓
│       ├── Agent: SummaryAgent ▶  <-- nested!
│       │   └── ...
│       └── Tool: archive ✓
└── Tool: ask_user ⏳  <-- awaiting input form
```

### ask_user 上下文展示

当子 Agent（或更深层 Agent）调用 `ask_user` 时，表单渲染在对应的展开块内，用户可清楚看到是哪个层级的 Agent 在请求输入。

### 前端改动

`deriveMessageState` 和 `ReActEventRenderer` 需要：

1. 检测 `tool_progress.data.status === 'agent_event'`，累积嵌套事件
2. 为 `agent_call` 类型的 tool block 渲染嵌套的时间线
3. 在嵌套事件中检测 `awaiting_input`，渲染表单

## 记忆系统

TODO - 子 Agent 的记忆隔离与上下文传递将在独立的记忆系统设计中处理。

## 递归控制

当前不设递归深度限制。依赖 Agent 设计的"子问题递减"原则保证自然收敛。

## 错误处理

| 错误场景       | 处理方式                                                                |
| -------------- | ----------------------------------------------------------------------- |
| Agent 不存在   | yield result: `{ success: false, error: "Agent not found: {agentId}" }` |
| Agent 执行失败 | yield result: `{ success: false, error: 错误信息 }`                     |
| 超时           | Abort 子上下文，yield result: `{ success: false, error: "Timeout" }`    |
| 父上下文取消   | 取消子上下文，正常退出（不 yield result）                               |

## 后续扩展

1. **并行调用** - 支持同时调用多个 Agent，聚合结果
2. **调用链追踪** - 记录完整的 Agent 调用链路，用于调试
