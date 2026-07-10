import { singleton } from 'tsyringe';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type {
  Hook,
  HookEffect,
  HookPhase,
} from '@/server/modules/agent/domain/model/hook';
import type { LoopCompactionConfig } from '@/server/modules/agent/domain/model/loop-config.fragment';
import { PROCESS_SUMMARY_PROMPT } from '@/server/modules/agent/domain/model/working-memory';
import { fold } from '@/server/libs/compaction';
import { estimateTokens } from '@/server/utils/estimateTokens';
import Logger from '@/server/utils/logger';
import { agentHook } from './registry';

/**
 * CompactionHook —— loop 迭代压缩（post-observation）。
 * 一条 monad 链：loop 段 = messages.drop(base)；older 折叠成 recap；新列表 = seed 前缀 + recap + 近期 recent。
 * WorkingMemory 只暴露 messages（monad 值）+ baseLength，不持压缩逻辑。
 * 是否生效由 apply 内部自判；不动则原样返回 null（无 condition 字段）。
 */
@singleton()
@agentHook
export class CompactionHook implements Hook {
  readonly id = 'compaction';
  readonly phase: HookPhase = 'post-observation';
  private readonly logger = Logger.child({ source: 'CompactionHook' });

  async apply(ctx: AgentRunContext): Promise<HookEffect | null> {
    const compaction = (
      ctx.config.runtimeConfig as {
        loop: LoopCompactionConfig;
      }
    ).loop;
    const contextSize = ctx.config.contextSize;
    if (!contextSize) return null;

    const list = ctx.workingMemory.messages;
    const base = ctx.workingMemory.baseLength;
    const loopActions = list.drop(base);
    if (loopActions.length <= compaction.keepRecent) return null;

    if (estimateTokens(list.toArray()) <= contextSize * compaction.threshold) {
      return null;
    }

    const recent = loopActions.takeLast(compaction.keepRecent);
    const older = loopActions.dropLast(compaction.keepRecent);

    try {
      const recap = await fold({
        messages: older.toArray(),
        windowSize: compaction.windowSize,
        signal: ctx.signal,
        prompt: PROCESS_SUMMARY_PROMPT,
      });
      if (!recap) return null;

      ctx.workingMemory.messages = list
        .take(base)
        .append({
          role: 'user',
          content: `Observation: [earlier steps in this turn — summarized]\n${recap}`,
        })
        .concat(recent);

      return {
        summary: 'compacted turn history',
        data: {
          usage: {
            used: estimateTokens(ctx.workingMemory.messages.toArray()),
            total: contextSize,
          },
        },
      };
    } catch (err) {
      this.logger.warn(
        `Iteration compaction failed: ${(err as Error)?.message ?? err}`,
      );
      return null;
    }
  }
}
