import type { LlmMessage } from '@/shared/types/entities';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import { winstonLogger } from '@/server/utils/logger';
import type { LoopCompactionConfig } from './loop-config.fragment';
import { estimateTokens } from '@/server/utils/estimateTokens';
import type { ContextUsage } from '@/server/utils/estimateTokens';
import { Summarizer } from '@/server/libs/compaction';

export interface CompactResult {
  compacted: boolean;
  usage: ContextUsage;
}

export interface WorkingMemoryParams {
  /** agent 提供的种子（conv 的有效历史经 buildIterMessages 格式化后的 LlmMessage[]）。 */
  seed: LlmMessage[];
  contextSize: number;
  modelId: string;
  /** per-run 的 LlmPort，折叠时复用（同模型、同取消域）。 */
  llm: LlmPort;
  /** 已 parse 的 runtimeConfig——压缩配置直取 loop 键（LoopCompactionConfig），不外泄。 */
  runtimeConfig: Record<string, unknown>;
}

/**
 * WorkingMemory — agent run 的瞬态、per-run loop 工作记忆（纯数据）。
 * 维护 iterMessages（loop 内逐条 append 并自压缩）。退出时本 loop 消亡（ctx 释放即回收）。
 * 压缩/折叠用与 conv 历史层同一 fold 原语（libs/compaction）。无 EventBus 依赖，可纯单测。
 */
export class WorkingMemory {
  private readonly iterMessages: LlmMessage[];
  /** seed 长度：压缩只动此下标之后（query/历史在前，不可变）。 */
  private readonly baseLen: number;
  private readonly contextSize: number;
  private readonly modelId: string;
  private readonly compaction: LoopCompactionConfig;
  private readonly summarizer: Summarizer;
  private readonly logger = winstonLogger.child({ source: 'WorkingMemory' });

  constructor(params: WorkingMemoryParams) {
    this.iterMessages = [...params.seed];
    this.baseLen = params.seed.length;
    this.contextSize = params.contextSize;
    this.modelId = params.modelId;
    this.compaction = (
      params.runtimeConfig as { loop: LoopCompactionConfig }
    ).loop;
    this.summarizer = new Summarizer(
      params.llm,
      this.logger,
      this.compaction.windowSize,
      this.modelId,
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
    return {
      used: estimateTokens(this.iterMessages, this.modelId),
      total: this.contextSize,
    };
  }

  append(role: LlmMessage['role'], content: string): void {
    this.iterMessages.push({ role, content });
  }

  /**
   * loop 内迭代压缩：用量超阈且步骤足够多时把较早的 loop actions 折叠成一条 Observation 回顾、
   * 保留最近 keepRecent 条。异常吞掉（压缩失败不影响 loop）。
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
   * loop 退出折叠：把本 loop 的 actions 折叠为过程摘要。
   * 仅在至少做过一次实质动作时触发（>1 条，避免对 trivial "直接回答" turn 浪费一次 LLM 调用）。
   * 异常吞掉返回 null。
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
