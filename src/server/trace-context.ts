import { AsyncLocalStorage } from 'async_hooks';

export interface TraceStore {
  requestId: string;
  userId?: string;
  /** agent run id（executor 绑定）——关联 loop/hook/LLM 调用日志到一次 run。 */
  runId?: string;
  /** 会话 id（conv 命令绑定）——关联 turn/transform/agent 日志到一次会话。 */
  conversationId?: string;
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
