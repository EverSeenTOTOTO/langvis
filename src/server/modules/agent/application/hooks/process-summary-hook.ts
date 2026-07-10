import { singleton } from 'tsyringe';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type {
  Hook,
  HookEffect,
  HookPhase,
} from '@/server/modules/agent/domain/model/hook';
import type { LoopCompactionConfig } from '@/server/modules/agent/domain/model/loop-config.fragment';
import { PROCESS_SUMMARY_PROMPT } from './prompts';
import { fold } from '@/server/libs/compaction';
import Logger from '@/server/utils/logger';
import { agentHook } from './registry';

/**
 * ProcessSummaryHook —— turn 过程摘要的**生产者**（loop-exit）。
 * response_user 终态时折叠本 loop 的 actions → 写 ctx.run.processSummary（executor 持久化到 AgentRun）。
 * 仅在至少做过一次实质动作时触发（loopActions > 1，避免 trivial「直接回答」turn 浪费一次 LLM 调用）。
 * WorkingMemory 不持此逻辑——它是外部 transform，读 messages（monad）+ baseLength（seed 边界）。
 */
@singleton()
@agentHook
export class ProcessSummaryHook implements Hook {
  readonly id = 'process-summary';
  readonly phase: HookPhase = 'loop-exit';
  private readonly logger = Logger.child({ source: 'ProcessSummaryHook' });

  async apply(ctx: AgentRunContext): Promise<HookEffect | null> {
    const compaction = (
      ctx.config.runtimeConfig as {
        loop: LoopCompactionConfig;
      }
    ).loop;
    const loopActions = ctx.workingMemory.messages.drop(
      ctx.workingMemory.baseLength,
    );
    if (loopActions.length <= 1) return null;

    try {
      const summary = await fold({
        messages: loopActions.toArray(),
        windowSize: compaction.windowSize,
        signal: ctx.signal,
        prompt: PROCESS_SUMMARY_PROMPT,
      });
      if (!summary) return null;
      ctx.run.processSummary = summary;
      return { summary: 'folded turn process summary' };
    } catch (err) {
      this.logger.warn(
        `Process summary failed: ${(err as Error)?.message ?? err}`,
      );
      return null;
    }
  }
}
