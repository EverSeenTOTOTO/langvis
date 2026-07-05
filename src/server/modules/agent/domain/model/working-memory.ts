import type { LlmMessage } from '@/shared/types/entities';
import Logger from '@/server/utils/logger';
import type { LoopCompactionConfig } from './loop-config.fragment';
import { estimateTokens } from '@/server/utils/estimateTokens';
import type { ContextUsage } from '@/server/utils/estimateTokens';
import { fold } from '@/server/libs/compaction';
import { Prompt } from '@/server/libs/prompt';

export interface CompactResult {
  compacted: boolean;
  usage: ContextUsage;
}

export interface WorkingMemoryParams {
  /** agent 提供的种子（conv 的有效历史 LlmMessage[]）。 */
  seed: LlmMessage[];
  contextSize: number;
  runtimeConfig: Record<string, unknown>;
}

/**
 * WorkingMemory — agent run 的瞬态、per-run loop 工作记忆（纯数据）。
 * 维护 iterMessages（loop 内逐条 append 并自压缩）。退出时本 loop 消亡（ctx 释放即回收）。
 */
export class WorkingMemory {
  private readonly iterMessages: LlmMessage[];
  /** seed 长度：压缩只动此下标之后（query/历史在前，不可变）。 */
  private readonly base: number;
  private readonly contextSize: number;
  private readonly compaction: LoopCompactionConfig;
  private readonly logger = Logger.child({ source: 'WorkingMemory' });

  constructor(params: WorkingMemoryParams) {
    this.iterMessages = [...params.seed];
    this.base = params.seed.length;
    this.contextSize = params.contextSize;
    this.compaction = (
      params.runtimeConfig as { loop: LoopCompactionConfig }
    ).loop;
  }

  async buildContext(): Promise<LlmMessage[]> {
    return this.iterMessages;
  }

  /** 调试用：seed 长度（loop actions = 此值之后的部分）。 */
  get baseLength(): number {
    return this.base;
  }

  getContextUsage(): ContextUsage {
    return {
      used: estimateTokens(this.iterMessages),
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
    const loopActions = this.iterMessages.slice(this.base);
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
      const recap = await fold({
        messages: older,
        windowSize: this.compaction.windowSize,
        signal,
        prompt: PROCESS_SUMMARY_PROMPT,
      });
      if (!recap) return { compacted: false, usage: before };

      // 截断到 baseLen 后追加回顾 + 近期；seed [0..baseLen) 不变。
      this.iterMessages.length = this.base;
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
   */
  async foldProcessSummary(signal: AbortSignal): Promise<string | null> {
    const loopActions = this.iterMessages.slice(this.base);
    if (loopActions.length <= 1) return null;

    try {
      return await fold({
        messages: loopActions,
        windowSize: this.compaction.windowSize,
        signal,
        prompt: PROCESS_SUMMARY_PROMPT,
      });
    } catch (err) {
      this.logger.warn(
        `Process summary failed: ${(err as Error)?.message ?? err}`,
      );
      return null;
    }
  }
}

/**
 * Process-summary prompt (mid-loop recap + loop-exit processSummary): folds an
 * agent turn's tool/observation trace into a concise summary of the WORK. The
 * final answer is delivered to the user and prepended to this summary verbatim
 * (see ConversationMemory.buildContext), so it must NOT be restated here —
 * capture the process that produced it (tools, attempts, difficulties, results).
 *
 * Static template: fold fills the History section per chunk (rolling summary is
 * threaded by fold itself, prepended as [previous summary]).
 */
const PROCESS_SUMMARY_PROMPT = Prompt.empty()
  .with('Role', 'You compact an agent turn into a concise process summary.')
  .with(
    'Instructions',
    'Fold the history below into a concise process summary of the WORK done: tools called and why, what was attempted, difficulties or errors, intermediate results, and key decisions. The history may begin with a previous summary — incorporate it. Capture the trajectory of work only — the final answer is delivered to the user separately and must NOT be restated or paraphrased. Be concise and chronological; do not fabricate.',
  )
  .with('History', '')
  .with(
    'Output',
    'Output only the process summary (no extra explanation, no Markdown headings).',
  );
