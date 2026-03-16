# TraceContext 设计文档

## 背景

当前项目中 trace 体系不完善，存在透传 `req`、`conversationId`、`userId` 等上下文信息的情况。计划使用 `AsyncLocalStorage` 建立完善的 trace 链路。

## 并发安全性

`AsyncLocalStorage` 基于 Node.js 的 `async_hooks` 实现，在并发模式下完全正常工作。每个 HTTP 请求都是独立的异步链，`als.run()` 创建的 store 会自动绑定到当前异步执行上下文，所有后续异步操作都会继承这个 store。

## 设计决策

### 方案选择

采用 **方案 A: TraceContext (ALS) + ExecutionContext (精简)**：

- ALS 存储不可变的追踪信息
- ExecutionContext 保留执行控制逻辑（AbortController、事件工厂）
- Logger 输出时自动从 ALS 读取上下文

### 职责拆分

| 组件             | 职责                                                     |
| ---------------- | -------------------------------------------------------- |
| TraceContext     | 存储追踪信息：requestId, userId, conversationId, traceId |
| ExecutionContext | 执行控制：AbortController, 事件工厂方法                  |

### 初始化策略

采用 **分阶段更新** 模式：

1. `requestId.ts` 初始化 `{ requestId }`
2. `auth.ts` 补充 `{ userId }`
3. `ChatController` 补充 `{ conversationId, traceId }` 后 freeze

### Freeze 机制

在 `conversationId` 和 `traceId` 设置完成后调用 `freeze()`，后续 `update()` 调用将抛出错误，防止深层调用意外修改上下文。

## 实现细节

### TraceContext 类

```typescript
// src/server/core/TraceContext.ts
import { AsyncLocalStorage } from 'async_hooks';

export interface TraceStore {
  requestId: string;
  userId?: string;
  conversationId?: string;
  traceId?: string;
  _frozen?: boolean;
}

class TraceContextHolder {
  private als = new AsyncLocalStorage<TraceStore>();

  get(): TraceStore | undefined {
    return this.als.getStore();
  }

  getOrFail(): TraceStore {
    const store = this.als.getStore();
    if (!store) throw new Error('TraceContext not initialized');
    return store;
  }

  run<T>(store: TraceStore, fn: () => T): T {
    return this.als.run(store, fn);
  }

  update(partial: Partial<Omit<TraceStore, '_frozen'>>): void {
    const store = this.als.getStore();
    if (!store) {
      throw new Error('TraceContext not initialized');
    }
    if (store._frozen) {
      throw new Error('TraceContext is frozen, cannot update');
    }
    Object.assign(store, partial);
  }

  freeze(): void {
    const store = this.als.getStore();
    if (store) store._frozen = true;
  }

  isFrozen(): boolean {
    return this.als.getStore()?._frozen ?? false;
  }
}

export const TraceContext = new TraceContextHolder();
```

### 入口层改造

**requestId.ts**

```typescript
import { TraceContext } from '../core/TraceContext';

export default async (app: Express) => {
  app.use(async (req, res, next) => {
    const requestId =
      req.id ?? req.headers['x-request-id'] ?? generateId('req');
    req.id = requestId;

    TraceContext.run({ requestId }, () => {
      res.setHeader('X-Request-Id', requestId);
      next();
    });
  });
};
```

**auth.ts**

```typescript
// 认证成功后
TraceContext.update({ userId: user.id });
```

**ChatController.chat()**

```typescript
async chat(...) {
  TraceContext.update({
    conversationId,
    traceId: conversationId
  });

  TraceContext.freeze();

  this.chatService.runSession(session, agent, memory, config);
}
```

### ExecutionContext 改造

```typescript
// src/server/core/ExecutionContext.ts
import { TraceContext } from './TraceContext';

export class ExecutionContext {
  get traceId(): string {
    return TraceContext.getOrFail().traceId!;
  }

  // 其余方法不变
}
```

### Logger 集成

```typescript
// src/server/utils/logger.ts
import { TraceContext } from '../core/TraceContext';

class Logger {
  private formatMeta(meta: Record<string, unknown>) {
    const trace = TraceContext.get();
    return {
      ...meta,
      requestId: trace?.requestId,
      userId: trace?.userId,
      conversationId: trace?.conversationId,
    };
  }

  info(message: string, meta?: Record<string, unknown>) {
    console.log(
      JSON.stringify({
        level: 'info',
        message,
        ...this.formatMeta(meta ?? {}),
      }),
    );
  }
}
```

## 影响范围

| 模块             | 改动                                 |
| ---------------- | ------------------------------------ |
| TraceContext     | 新增                                 |
| requestId.ts     | 初始化 TraceContext                  |
| auth.ts          | 补充 userId                          |
| ChatController   | 补充 conversationId/traceId + freeze |
| ExecutionContext | 移除 traceId 字段                    |
| Logger           | 自动读取上下文                       |
| Tool/Agent       | 移除显式 traceId 传递                |
| cache.ts 等工具  | 从 TraceContext 获取 traceId         |

## 测试策略

1. 并发测试：验证多个并发请求的上下文隔离
2. Freeze 测试：验证 freeze 后 update 抛错
3. 集成测试：验证 Logger 自动附加上下文
