import { AsyncLocalStorage } from 'async_hooks';

export interface TraceStore {
  requestId: string;
  userId?: string;
  conversationId?: string;
  messageId?: string;
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
