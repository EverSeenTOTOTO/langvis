import type { RunStatus } from '@/shared/types/agent';
import type { EnrichedEvent } from '@/shared/types/events';
import { projectRun, type RunView } from './run-projection';

/** 缓存容量上限——超限逐最旧（LRU，Map 插入序即新近序）。 */
const MAX_CACHED_VIEWS = 500;

// 终态 run 的投影缓存：终态行事件流已冻结（commit 一次性原子写 events+status），projectRun 纯 fold
// 结果恒定 → 命中即权威永不失效；非终态（initialized/running）事件还在长，不入缓存直接 fold。
export class RunViewCache {
  /** 容量可变实例字段——测试可调小验证逐出。 */
  maxEntries = MAX_CACHED_VIEWS;
  private readonly views = new Map<string, RunView>();

  project(run: {
    id: string;
    status: RunStatus;
    events: EnrichedEvent[] | null;
  }): RunView {
    if (!this.isTerminal(run.status)) return projectRun(run.events ?? []);

    const hit = this.views.get(run.id);
    if (hit) {
      // delete+set 刷新新近度，使 Map 插入序保持 LRU 序。
      this.views.delete(run.id);
      this.views.set(run.id, hit);
      return hit;
    }

    const view = projectRun(run.events ?? []);
    this.views.set(run.id, view);
    if (this.views.size > this.maxEntries) {
      const oldest = this.views.keys().next().value;
      if (oldest !== undefined) this.views.delete(oldest);
    }
    return view;
  }

  private isTerminal(status: RunStatus): boolean {
    return (
      status === 'completed' || status === 'failed' || status === 'cancelled'
    );
  }
}
