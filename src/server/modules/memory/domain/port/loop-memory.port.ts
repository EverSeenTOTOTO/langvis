import type { LlmMessage } from '@/shared/types/entities';

/**
 * LoopMemoryPort —— memory 对 agent 暴露的同步 Customer-Supplier 契约（per-run、runId 索引）。
 *
 * agent 的 ReAct loop 每轮迭代需要「同步」拿到上下文（下一轮 LLM 调用前必须就绪）——同步需求
 * 不走事件（事件是异步通知用的），走端口（Customer-Supplier）。memory 全程不感知 conversation，
 * 也不感知 agent：它只实现本端口，由 agent 经 token 注入调用；生命周期（beginRun/endRun）亦由
 * agent 驱动。memory 内部维护 `Map<runId, WorkingMemory>`，压缩时机是 memory 自己的逻辑（agent
 * 永不点名 compact）。
 */
export const LOOP_MEMORY_PORT = Symbol('LOOP_MEMORY_PORT');

export interface LoopMemoryConfig {
  contextSize: number;
  modelId: string;
  runtimeConfig: Record<string, unknown>;
}

export interface LoopMemoryPort {
  /** 登记一次 run：以 agent 提供的 seed（已格式化）播种 WorkingMemory。须在 requestContext 前调用。 */
  beginRun(runId: string, seed: LlmMessage[], config: LoopMemoryConfig): void;

  /** 申请本迭代上下文（memory 内部按需压缩后返回）。 */
  requestContext(runId: string, signal: AbortSignal): Promise<LlmMessage[]>;

  /** 记录一次迭代结果（assistant 输出 / observation）——memory append 并自报 loop 用量。 */
  record(runId: string, role: LlmMessage['role'], content: string): void;

  /** 本轮结束折叠过程摘要（response_user 时）。 */
  summarizeProcess(runId: string, signal: AbortSignal): Promise<string | null>;

  /** 释放本次 run 的 WorkingMemory（run 结束时由 agent 调用）。 */
  endRun(runId: string): void;
}
