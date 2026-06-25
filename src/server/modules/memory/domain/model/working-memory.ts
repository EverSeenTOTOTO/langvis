import type { LlmMessage } from '@/shared/types/entities';
import type { ContextUsage } from './memory.types';
import type { ContextPort } from '../port/context.port';
import type { LlmPort } from '@/server/modules/agent/domain/port/llm.port';
import type { Logger } from '@/server/utils/logger';
import type { CompactionConfig } from '../service/compaction-config';
import { measureUsage } from '../service/measure-usage';
import { Summarizer } from '../service/summarizer';

export interface CompactResult {
  compacted: boolean;
  usage: ContextUsage;
}

export interface WorkingMemoryParams {
  /** ConversationMemory.buildContext() 的产物（经 buildIterMessages 转换）作为种子。 */
  seed: LlmMessage[];
  contextSize: number;
  modelId: string;
  /** per-run 的 LlmPort（即 ctx.llm），折叠时复用（同模型、同取消域）。 */
  llm: LlmPort;
  compaction: CompactionConfig;
  logger: Logger;
}

/**
 * WorkingMemory — 瞬态、per-run 的迭代上下文层，与 ConversationMemory 地位对等。
 *
 * ConversationMemory 维护 historyMessages（持久、运行期只读）；WorkingMemory 维护
 * iterMessages（瞬态、loop 内逐条 append 并自压缩）。由会话上下文播种，loop 每步 append；
 * 自身用量超阈时把较早的 loop actions 折叠为一条 Observation 回顾（保留近期 keepRecent），
 * 使 loop 能在自身膨胀时继续；退出时把本 loop 过程折叠为过程摘要。fold 原语与历史层压缩
 * 同一机制。临时产物，loop 内消亡。
 *
 * compact/foldProcessSummary 是纯数据操作，返回结果；事件由编排（loop）yield，保持可单测。
 */
export class WorkingMemory implements ContextPort {
  private readonly iterMessages: LlmMessage[];
  /** seed 长度：压缩只动此下标之后（query/历史在前，不可变）。 */
  private readonly baseLen: number;
  private readonly contextSize: number;
  private readonly modelId: string;
  private readonly compaction: CompactionConfig;
  private readonly summarizer: Summarizer;
  private readonly logger: Logger;

  constructor(params: WorkingMemoryParams) {
    this.iterMessages = [...params.seed];
    this.baseLen = params.seed.length;
    this.contextSize = params.contextSize;
    this.modelId = params.modelId;
    this.compaction = params.compaction;
    this.logger = params.logger;
    this.summarizer = new Summarizer(
      params.llm,
      params.logger,
      params.compaction.windowSize,
    );
  }

  async buildContext(): Promise<LlmMessage[]> {
    return this.iterMessages;
  }

  /** 调试用：seed 长度（loop actions = 此值之后的部分）。 */
  get baseLength(): number {
    return this.baseLen;
  }

  getContextUsage(): ContextUsage {
    return measureUsage(this.iterMessages, this.modelId, this.contextSize);
  }

  append(role: LlmMessage['role'], content: string): void {
    this.iterMessages.push({ role, content });
  }

  /**
   * loop 内迭代压缩：iterMessages 用量超阈且 loop 步骤足够多时，把较早的 loop actions
   * 折叠成一条 Observation 回顾、保留最近 keepRecent 条。返回是否压缩 + 压缩后用量；
   * 不压缩时返回压缩前用量。异常吞掉（压缩失败不影响 loop）。
   */
  async compact(signal: AbortSignal): Promise<CompactResult> {
    const loopActions = this.iterMessages.slice(this.baseLen);
    if (loopActions.length <= this.compaction.keepRecent) {
      return { compacted: false, usage: this.getContextUsage() };
    }

    const before = this.getContextUsage();
    if (before.used <= this.contextSize * this.compaction.threshold) {
      return { compacted: false, usage: before };
    }

    const recent = loopActions.slice(-this.compaction.keepRecent);
    const older = loopActions.slice(0, -this.compaction.keepRecent);

    try {
      const recap = await this.summarizer.fold(null, older, signal);
      if (!recap) return { compacted: false, usage: before };

      // 截断到 baseLen 后追加回顾 + 近期；seed [0..baseLen) 不变。
      this.iterMessages.length = this.baseLen;
      this.iterMessages.push({
        role: 'user',
        content: `Observation: [earlier steps in this turn — summarized]\n${recap}`,
      });
      this.iterMessages.push(...recent);

      return { compacted: true, usage: this.getContextUsage() };
    } catch (err) {
      this.logger.warn(
        `Iteration compaction failed: ${(err as Error)?.message ?? err}`,
      );
      return { compacted: false, usage: before };
    }
  }

  /**
   * loop 退出折叠：把本 loop 的 actions（query 之后追加的部分）折叠为过程摘要。
   * 仅在至少做过一次实质动作时触发（>1 条，避免对"直接回答"的 trivial turn 浪费一次 LLM 调用）。
   * 异常吞掉返回 null（异常退出/折叠失败不产过程摘要）。
   */
  async foldProcessSummary(signal: AbortSignal): Promise<string | null> {
    const loopActions = this.iterMessages.slice(this.baseLen);
    if (loopActions.length <= 1) return null;

    try {
      return await this.summarizer.fold(null, loopActions, signal);
    } catch (err) {
      this.logger.warn(
        `Process summary failed: ${(err as Error)?.message ?? err}`,
      );
      return null;
    }
  }
}
