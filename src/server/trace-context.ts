import { AsyncLocalStorage } from 'async_hooks';

export interface TraceStore {
  requestId: string;
  userId?: string;
  /** agent run id（executor 绑定）——关联 loop/hook/LLM 调用日志到一次 run。 */
  runId?: string;
  /** 会话 id（conv 命令绑定）——关联 turn/transform/agent 日志到一次会话。 */
  conversationId?: string;
  // 每请求会话校验记忆化（AuthService 读写）：同 cookie 在单请求内只打一次 DB。 生命周期 = 请求，登出/换号即刻生效；无请求上下文（WS/后台事件）时缺席。
  authMemo?: { cookie: string; data: unknown };
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

  update(partial: Partial<TraceStore>): void {
    const store = this.als.getStore();
    if (!store) {
      throw new Error('TraceContext not initialized');
    }
    Object.assign(store, partial);
  }
}

export const TraceContext = new TraceContextHolder();
