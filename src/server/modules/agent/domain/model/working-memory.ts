import type { LlmMessage } from '@/shared/types/entities';
import Logger from '@/server/utils/logger';
import type { LoopCompactionConfig } from './loop-config.fragment';
import { estimateTokens } from '@/server/utils/estimateTokens';
import type { ContextUsage } from '@/server/utils/estimateTokens';
import { fold } from '@/server/libs/compaction';
import { Prompt } from '@/server/libs/prompt';
import { MessageList } from '@/server/libs/messages';

export interface WorkingMemoryParams {
  /** agent 提供的种子（conv 的有效历史 LlmMessage[]）。 */
  seed: LlmMessage[];
  contextSize: number;
  runtimeConfig: Record<string, unknown>;
}

/**
 * WorkingMemory — agent run 的瞬态、per-run loop 工作记忆（贫血）。
 * 状态是一个 MessageList monad（messages）+ seed 边界（base）；不持 policy——
 * 压缩等 transform 是外部 hook：读 messages、用 monad 链算出新 MessageList、整体写回。
 * 退出时本 loop 消亡（ctx 释放即回收）。
 */
export class WorkingMemory {
  /** loop 工作列表（薄消息 monad，不可变；transform 通过替换整个值来「改」）。 */
  messages: MessageList<LlmMessage>;
  private readonly base: number;
  private readonly contextSize: number;
  private readonly compaction: LoopCompactionConfig;
  private readonly logger = Logger.child({ source: 'WorkingMemory' });

  constructor(params: WorkingMemoryParams) {
    this.messages = MessageList.of(params.seed);
    this.base = params.seed.length;
    this.contextSize = params.contextSize;
    this.compaction = (
      params.runtimeConfig as { loop: LoopCompactionConfig }
    ).loop;
  }

  async buildContext(): Promise<LlmMessage[]> {
    return this.messages.toArray();
  }

  /** seed 长度（loop actions = messages.drop(base)）。 */
  get baseLength(): number {
    return this.base;
  }

  getContextUsage(): ContextUsage {
    return {
      used: estimateTokens(this.messages.toArray()),
      total: this.contextSize,
    };
  }

  append(role: LlmMessage['role'], content: string): void {
    this.messages = this.messages.append({ role, content });
  }

  /**
   * loop 退出折叠：把本 loop 的 actions 折叠为过程摘要。仅在至少做过一次实质动作时触发（>1 条）。
   * 生产者 transform 的雏形——processSummary 迁移（落 AgentRun）时外迁为独立 transform。
   */
  async foldProcessSummary(signal: AbortSignal): Promise<string | null> {
    const loopActions = this.messages.drop(this.base);
    if (loopActions.length <= 1) return null;

    try {
      return await fold({
        messages: loopActions.toArray(),
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

export const PROCESS_SUMMARY_PROMPT = Prompt.empty()
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
