import { inject, singleton } from 'tsyringe';
import type { LlmMessage } from '@/shared/types/entities';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import { LLM_PORT } from '@/server/libs/ports/llm/llm.tokens';
import { EventBus, createDomainEvent } from '@/server/libs/ddd';
import { WorkingMemory } from '../../domain/model/working-memory';
import { LoopUsageReported } from '../../contracts';
import type {
  LoopMemoryConfig,
  LoopMemoryPort,
} from '../../domain/port/loop-memory.port';

/**
 * LoopMemoryService —— memory 对 agent 的同步 Customer-Supplier 实现。
 *
 * 拥有 per-run 的 WorkingMemory 注册表（`Map<runId, WorkingMemory>`），由 agent 经
 * LoopMemoryPort 驱动生命周期（beginRun/endRun）。压缩时机是 memory 的逻辑：requestContext
 * 内部按需压缩（agent 永不点名 compact）。loop 用量自报由本服务编排——WorkingMemory 是纯数据，
 * 用量在 record（每步追加后）与 requestContext（压缩后）变化时，本服务经 EventBus 发
 * LoopUsageReported（仅 runId，memory 不感知 conversation）。
 */
@singleton()
export class LoopMemoryService implements LoopMemoryPort {
  private readonly runs = new Map<string, WorkingMemory>();

  constructor(
    @inject(LLM_PORT) private readonly llm: LlmPort,
    @inject(EventBus) private readonly eventBus: EventBus,
  ) {}

  beginRun(runId: string, seed: LlmMessage[], config: LoopMemoryConfig): void {
    this.runs.set(
      runId,
      new WorkingMemory({
        seed,
        contextSize: config.contextSize,
        modelId: config.modelId,
        llm: this.llm,
        runtimeConfig: config.runtimeConfig,
      }),
    );
  }

  async requestContext(
    runId: string,
    signal: AbortSignal,
  ): Promise<LlmMessage[]> {
    const working = this.require(runId);
    const result = await working.compact(signal);
    if (result.compacted) this.reportUsage(runId, working);
    return working.buildContext();
  }

  record(runId: string, role: LlmMessage['role'], content: string): void {
    const working = this.require(runId);
    working.append(role, content);
    this.reportUsage(runId, working);
  }

  async summarizeProcess(
    runId: string,
    signal: AbortSignal,
  ): Promise<string | null> {
    return this.require(runId).foldProcessSummary(signal);
  }

  endRun(runId: string): void {
    this.runs.delete(runId);
  }

  private require(runId: string): WorkingMemory {
    const working = this.runs.get(runId);
    if (!working) {
      throw new Error(
        `LoopMemory: run ${runId} not begun (beginRun missing before request)`,
      );
    }
    return working;
  }

  private reportUsage(runId: string, working: WorkingMemory): void {
    const { used, total } = working.getContextUsage();
    this.eventBus.dispatch(
      LoopUsageReported,
      createDomainEvent(LoopUsageReported, runId, { runId, used, total }),
    );
  }
}
