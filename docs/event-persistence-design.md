# AgentEvent 持久化与渲染设计

## 概述

本文档描述如何将 AgentEvent 实时持久化并在前端渲染，实现统一的收发层、Agent 特定的渲染，以及数据以结构化格式持久化以便历史回显。

## 核心原则

- **实时渲染 + 持久化兼顾** — SSE 流式时实时渲染，`final` 时持久化到数据库
- **聚合摘要存储** — 存储关键节点（thought/tool），不存储原始事件流
- **嵌套工具调用** — tool_call 与 tool_result 合并，保持语义关联
- **tool_progress 仅实时展示** — 中间状态不持久化
- **Store 驱动渲染** — 所有事件通过 Store 更新，优化单条消息重绘

## 数据结构

### StepEvent

`meta.steps` 的元素类型：

```typescript
type StepEvent =
  | { type: 'thought'; content: string }
  | {
      type: 'tool';
      name: string;
      args: string;
      output?: string;
      error?: string;
    };
```

### ToolEvent

工具内部事件类型（新增独立的 error 类型）：

```typescript
type ToolEvent =
  | { type: 'progress'; toolName: string; data: unknown }
  | { type: 'result'; toolName: string; output: string }
  | { type: 'error'; toolName: string; error: string };
```

### AgentEvent

扩展 AgentEvent 类型，添加 `meta` 字段用于携带聚合状态：

```typescript
type AgentEvent =
  | { type: 'thought'; content: string; meta?: { steps: StepEvent[] } }
  | {
      type: 'tool_call';
      toolName: string;
      toolArgs: string;
      meta?: { steps: StepEvent[] };
    }
  | { type: 'tool_progress'; toolName: string; data: unknown }
  | {
      type: 'tool_result';
      toolName: string;
      output: string;
      meta?: { steps: StepEvent[] };
    }
  | {
      type: 'tool_error';
      toolName: string;
      error: string;
      meta?: { steps: StepEvent[] };
    }
  | { type: 'stream'; content: string }
  | { type: 'final' }
  | { type: 'error'; error: string };
```

### MessageMeta

```typescript
interface MessageMeta {
  steps?: StepEvent[];
  error?: string;
  loading?: boolean;
  streaming?: boolean;
}
```

## 后端架构

### ExecutionContext 扩展

ExecutionContext 内部维护 `_steps` 数组，自动聚合 thought/tool 事件：

```typescript
class ExecutionContext {
  private _steps: StepEvent[] = [];

  // === AgentEvent helpers ===

  agentThoughtEvent(content: string): AgentEvent {
    this._steps.push({ type: 'thought', content });
    return { type: 'thought', content, meta: { steps: [...this._steps] } };
  }

  agentToolCallEvent(name: string, args: string): AgentEvent {
    this._steps.push({ type: 'tool', name, args });
    return {
      type: 'tool_call',
      toolName: name,
      toolArgs: args,
      meta: { steps: [...this._steps] },
    };
  }

  agentToolResultEvent(name: string, output: string): AgentEvent {
    const tool = this._steps.findLast(
      s => s.type === 'tool' && s.name === name && !s.output && !s.error,
    );
    if (tool && tool.type === 'tool') tool.output = output;
    return {
      type: 'tool_result',
      toolName: name,
      output,
      meta: { steps: [...this._steps] },
    };
  }

  agentToolErrorEvent(name: string, error: string): AgentEvent {
    const tool = this._steps.findLast(
      s => s.type === 'tool' && s.name === name && !s.output && !s.error,
    );
    if (tool && tool.type === 'tool') tool.error = error;
    return {
      type: 'tool_error',
      toolName: name,
      error,
      meta: { steps: [...this._steps] },
    };
  }

  agentStreamEvent(content: string): AgentEvent {
    return { type: 'stream', content };
  }

  agentFinalEvent(): AgentEvent {
    return { type: 'final' };
  }

  agentErrorEvent(error: string): AgentEvent {
    return { type: 'error', error };
  }

  get steps(): StepEvent[] {
    return this._steps;
  }
}
```

### ChatService 改造

实时更新内存 `message.meta.steps`，`final` 时持久化到数据库：

```typescript
async consumeAgentStream(
  conversationId: string,
  message: Message,
  agent: Agent,
  memory: Memory,
  config: Record<string, unknown>,
  traceId: string,
): Promise<void> {
  const controller = new AbortController();
  const ctx = ExecutionContext.create(traceId, controller);

  this.activeAgents.set(conversationId, ctx);

  try {
    const generator = agent.call(memory, ctx, config);

    for await (const event of generator) {
      if (ctx.signal.aborted) break;

      // 实时更新内存 message.meta.steps
      if ('meta' in event && event.meta?.steps) {
        message.meta = { ...message.meta, steps: event.meta.steps };
      }

      if (event.type === 'stream') {
        message.content += event.content;
      } else if (event.type === 'error') {
        throw new Error(event.error);
      }

      this.sseService.sendToConversation(conversationId, event);
    }

    // final 时持久化到数据库
    await this.conversationService.updateMessage(
      message.id,
      message.content,
      { steps: ctx.steps }
    );
  } catch (error) {
    await this.handleStreamError(conversationId, message, error, ctx);
  } finally {
    this.activeAgents.delete(conversationId);
  }
}
```

## 前端架构

### ChatStore.handleSSEMessage 扩展

处理所有事件类型，合并 `meta.steps`：

```typescript
private handleSSEMessage(conversationId: string, msg: AgentEvent) {
  if (this.conversationStore.currentConversationId !== conversationId) {
    return;
  }

  const message = this.getLastMessage(conversationId);
  if (!message) return;

  // 合并 meta.steps（如果事件携带）
  if ('meta' in msg && msg.meta?.steps) {
    message.meta = { ...message.meta, steps: msg.meta.steps };
  }

  switch (msg.type) {
    case 'stream':
      this.conversationStore.updateStreamingMessage(conversationId, msg.content);
      break;
    case 'final':
      this.disconnectFromSSE(conversationId);
      this.conversationStore.getMessagesByConversationId({ id: conversationId });
      break;
    case 'error':
      this.disconnectFromSSE(conversationId);
      this.conversationStore.getMessagesByConversationId({ id: conversationId });
      break;
  }
}
```

### 渲染组件

#### 通用 Step 渲染器

```tsx
interface StepRendererProps {
  steps: StepEvent[];
}

const StepRenderer: React.FC<StepRendererProps> = ({ steps }) => (
  <div className="agent-steps">
    {steps.map((step, i) =>
      step.type === 'thought' ? (
        <ThoughtBlock key={i} content={step.content} />
      ) : (
        <ToolBlock
          key={i}
          name={step.name}
          args={step.args}
          output={step.output}
          error={step.error}
        />
      ),
    )}
  </div>
);
```

#### Agent 特定渲染

每种 Agent 可自定义 StepRenderer 的样式/布局，通过 `AssistantMessage` 分发：

```tsx
const AssistantMessage: React.FC<{ msg: Message }> = ({ msg }) => {
  const agent = getCurrentAgent();

  return (
    <Bubble
      content={
        <>
          {msg.meta?.steps && <StepRenderer steps={msg.meta.steps} />}
          <MarkdownRender>{msg.content}</MarkdownRender>
        </>
      }
      loading={msg.meta?.loading}
    />
  );
};
```

## 数据流

```
用户发送消息
    ↓
ChatController.chat()
    → 创建 assistantMessage (meta: { loading: true })
    ↓
ChatService.consumeAgentStream()
    ↓ (循环)
    Agent yield AgentEvent
    → ExecutionContext 累积 steps
    → ChatService 更新内存 message.meta.steps
    → SSE 发送事件 (携带 meta.steps)
    ↓
前端 handleSSEMessage()
    → 合并 message.meta.steps
    → AssistantMessage 重绘 (仅该组件)
    ↓ (final)
ChatService 持久化 message.meta.steps 到数据库
    ↓
前端刷新消息列表
```

## 文件变更清单

### 后端

1. `src/shared/types/index.ts` — 更新 `AgentEvent` 和 `StepEvent` 类型
2. `src/server/core/context/index.ts` — ExecutionContext 添加 steps 聚合逻辑
3. `src/server/service/ChatService.ts` — 实时更新 message.meta.steps

### 前端

1. `src/client/store/modules/chat.ts` — handleSSEMessage 添加 steps 合并逻辑
2. `src/client/pages/Home/components/AssistantMessage.tsx` — 渲染 steps
3. `src/client/pages/Home/components/AgentMessage/*.tsx` — Agent 特定渲染（可选优化）
