# AgentCallTool 设计文档

## 概述

AgentCallTool 是一个元工具（Meta Tool），允许一个 Agent 调用另一个 Agent 作为子任务。这使得 ReActAgent 可以编排多个专业 Agent，实现复杂工作流。

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
┌─────────────────────────────────────────────────────┐
│                   ReActAgent                        │
│                                                     │
│  "分析这个链接"                                     │
│       │                                             │
│       ▼                                             │
│  WebFetchTool ──→ AgentCallTool ──→ NoteTool        │
│       │               │               │             │
│       │          ┌────┴────┐          │             │
│       │          │         │          │             │
│       │          ▼         ▼          │             │
│       │    DocumentAnalysisAgent      │             │
│       │    (子 Agent，内部消化事件)   │             │
│       │                               │             │
└───────┴───────────────────────────────┴─────────────┘
```

## 设计原则

### 内部消化，对外一致

CallAgentTool 在内部处理子 Agent 的所有事件，对外表现与普通 Tool 无异。前端无需任何改动。

### 子问题递减

每层 Agent 调用应处理更小的子问题，确保递归自然收敛。MAX_DEPTH 作为兜底防护，而非主要控制手段。

## 接口设计

### 输入

```typescript
interface AgentCallInput {
  agentId: string;
  input: Record<string, any>;
  config?: {
    timeout?: number; // 默认 60000ms
  };
}
```

### 输出

```typescript
interface AgentCallOutput {
  success: boolean;
  content?: string; // 子 Agent 累积的最终内容
  error?: string;
}
```

### Tool 配置

AgentCallTool 是通用工具，不感知可调用哪些 Agent。可用 Agent 列表由 ReAct Agent 的配置动态注入到 prompt 中：

```typescript
// AgentCallTool 配置
export const AgentCallToolConfig: ToolConfig = {
  id: ToolIds.AGENT_CALL,
  name: 'agent_call',
  description: `调用其他 Agent 执行子任务。输入格式：
{
  "agentId": "agent_id_here",
  "input": { ... },
  "config": { "timeout": 60000 }
}`,
  parameters: {
    type: 'object',
    properties: {
      agentId: { type: 'string', description: '目标 Agent ID' },
      input: { type: 'object', description: '传递给 Agent 的输入数据' },
      config: {
        type: 'object',
        properties: {
          timeout: {
            type: 'number',
            description: '超时时间（毫秒），默认 60000',
          },
        },
      },
    },
    required: ['agentId', 'input'],
  },
};
```

### ReAct Agent 配置

Agent 通过 ReAct config 注册，与 tools 类似：

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

## 事件消化策略

CallAgentTool 对外只暴露"正在进行"的状态，不暴露子 Agent 内部细节：

| 子 Agent 事件              | 处理方式                                                                |
| -------------------------- | ----------------------------------------------------------------------- |
| `start`                    | 忽略                                                                    |
| `thought`                  | 忽略（内部推理）                                                        |
| `tool_call`                | yield progress: `{ status: 'running', detail: '调用工具: {toolName}' }` |
| `tool_progress`            | 忽略（可选：长任务时 yield 心跳）                                       |
| `tool_result`/`tool_error` | 忽略（工具结束由 tool_call 暗示）                                       |
| `stream`                   | 累积到 `content`，不 yield                                              |
| `final`                    | 忽略，结束循环                                                          |
| `error`                    | 记录错误，跳出循环                                                      |

对外事件序列示例：

```
progress: { status: 'calling', agentId: 'document_analysis_agent' }
progress: { status: 'running', detail: '调用工具: web_fetch' }
progress: { status: 'running', detail: '调用工具: llm_call' }
result: { success: true, content: '分析结果...' }
```

前端 EventRenderer 无需任何改动即可正常渲染。

## 多重嵌套与递归控制

如果子 Agent 内部又调用了 AgentCallTool，会递归消化，对外表现一致。

### 深度限制

ExecutionContext 增加 `depth` 属性，默认为 0。AgentCallTool 检查深度：

```typescript
const MAX_DEPTH = 3;
if (ctx.depth >= MAX_DEPTH) {
  yield ctx.toolResultEvent(this.id, {
    success: false,
    error: `Agent call depth exceeded: ${ctx.depth}`,
  });
  return;
}
```

### 递归收敛原则

深度限制是兜底防护，核心靠**子问题递减**原则保证收敛：

- 每层 Agent 调用处理更小、更具体的子问题
- 避免同一问题在不同层级重复处理
- 例如：文章总结 Agent → 话题拓展 Agent → 文章总结 Agent（处理新文档片段）

合理的递归协作是允许的，MAX_DEPTH 防止的是无意义的死循环。

## 调用伪代码

```typescript
async *call(input: AgentCallInput, ctx: ExecutionContext) {
  const { agentId, input: agentInput, config = {} } = input;
  const { timeout = 60000 } = config;

  // 深度检查
  const MAX_DEPTH = 3;
  if (ctx.depth >= MAX_DEPTH) {
    yield ctx.toolResultEvent(this.id, {
      success: false,
      error: `Agent call depth exceeded: ${ctx.depth}`
    });
    return;
  }

  // 解析 Agent
  let agent: Agent;
  try {
    agent = container.resolve<Agent>(agentId);
  } catch {
    yield ctx.toolResultEvent(this.id, {
      success: false,
      error: `Agent not found: ${agentId}`
    });
    return;
  }

  // 创建子上下文
  const childCtx = createChildContext(ctx, timeout);

  // 子 Agent 使用独立 Memory，上下文通过 input 显式传递
  const memory = container.resolve<Memory>('Memory');

  // yield 开始状态
  yield ctx.toolProgressEvent(this.id, { status: 'calling', agentId });

  // 执行子 Agent，消化事件
  let content = '';
  try {
    for await (const event of agent.call(memory, childCtx, agentInput)) {
      switch (event.type) {
        case 'stream':
          content += event.content;
          break;
        case 'tool_call':
          yield ctx.toolProgressEvent(this.id, {
            status: 'running',
            detail: `调用工具: ${event.toolName}`
          });
          break;
        case 'error':
          throw new Error(event.error);
        // start, thought, tool_progress, tool_result, tool_error, final 忽略
      }
    }
    yield ctx.toolResultEvent(this.id, { success: true, content });
  } catch (error) {
    yield ctx.toolResultEvent(this.id, {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
```

## 子上下文创建

```typescript
function createChildContext(
  parentCtx: ExecutionContext,
  timeout: number,
): ExecutionContext {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  // 父上下文取消时，级联取消
  parentCtx.signal.addEventListener('abort', () => {
    clearTimeout(timeoutId);
    controller.abort(parentCtx.signal.reason);
  });

  // 创建子 message（独立累积 stream 内容）
  const childMessage = { id: uuid(), content: '', meta: {} };

  // 创建子上下文，depth + 1
  return new ExecutionContext(childMessage, controller, parentCtx.depth + 1);
}
```

## Agent 输入约定

被调用的 Agent 通过第三个参数接收输入：

```typescript
@agent(AgentIds.DOCUMENT_ANALYSIS)
export default class DocumentAnalysisAgent extends Agent {
  async *call(
    memory: Memory,
    ctx: ExecutionContext,
    input?: DocumentAnalysisInput, // AgentCallTool 传入的 input
  ): AsyncGenerator<AgentEvent, void, void> {
    // ...
  }
}
```

## 错误处理

| 错误场景       | 处理方式                                                                |
| -------------- | ----------------------------------------------------------------------- |
| Agent 不存在   | yield result: `{ success: false, error: "Agent not found: {agentId}" }` |
| 深度超限       | yield result: `{ success: false, error: "Agent call depth exceeded" }`  |
| Agent 执行失败 | yield result: `{ success: false, error: 错误信息 }`                     |
| 超时           | Abort 子上下文，yield result: `{ success: false, error: "Timeout" }`    |
| 父上下文取消   | 取消子上下文，正常退出（不 yield result）                               |

## 安全考虑

1. **深度限制**：MAX_DEPTH = 3 防止递归过深
2. **超时限制**：子 Agent 超时应短于父 Agent
3. **子问题递减**：设计 Agent 时确保每层处理更小的问题集

## 后续扩展

1. **并行调用**：支持同时调用多个 Agent，聚合结果
2. **调用链追踪**：记录完整的 Agent 调用链路，用于调试
