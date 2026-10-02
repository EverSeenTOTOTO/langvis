import { Inject } from '@nestjs/common';
import type {
  ContextStage,
  StageTarget,
  StageEvent,
} from '@/server/shared/context';
import { SNAPSHOT_PROMPT } from '@/server/shared/context';
import { fold } from '@/server/shared/compaction';
import { estimateTokens } from '@/server/utils/estimateTokens';
import { LLM_PORT } from '@/server/infrastructure/llm/llm.tokens';
import type { LlmPort } from '@/server/infrastructure/llm/llm.port';
import { ModelRegistryService } from '@/server/infrastructure/model-registry.service';
import Logger from '@/server/utils/logger';
import { isPinnedObservation } from '@/server/modules/agent/domain/offload/pin';
import type { LlmMessage } from '@/shared/types/entities';

/** run 域折叠：loop 动作轨迹 → 结构化状态快照（瞬态，run 结束即弃；快照链式续接）。 */
export class RunFoldStage implements ContextStage {
  readonly id = 'run-fold';
  readonly phase = 'post-observation' as const;
  private readonly logger = Logger.child({ source: 'RunFoldStage' });

  constructor(
    @Inject(ModelRegistryService)
    private readonly modelRegistry: ModelRegistryService,
    @Inject(LLM_PORT) private readonly llm: LlmPort,
  ) {}

  async *apply(target: StageTarget): AsyncGenerator<StageEvent, void> {
    if (target.kind !== 'run') return;
    const ctx = target;
    const compaction = ctx.runtimeConfig.context?.runFold;
    if (!compaction)
      return this.logger.debug(`skip (run ${ctx.runId}): runFold config off`);
    const contextSize = this.modelRegistry.resolveContextSize(
      ctx.runtimeConfig,
    );
    if (!contextSize)
      return this.logger.debug(
        `skip (run ${ctx.runId}): contextSize unresolved`,
      );

    const list = ctx.messages;
    const base = ctx.base;
    const loopActions = list.slice(base);
    if (loopActions.length <= compaction.keepRecent)
      return this.logger.debug(
        `skip (run ${ctx.runId}): loop actions ${loopActions.length} <= keepRecent ${compaction.keepRecent}`,
      );

    const beforeTokens = estimateTokens(list);
    if (beforeTokens <= contextSize * compaction.threshold)
      return this.logger.debug(
        `skip (run ${ctx.runId}): tokens ${beforeTokens} <= ${Math.round(contextSize * compaction.threshold)} (window×threshold)`,
      );

    const keep = compaction.keepRecent;
    const recent = loopActions.slice(-keep);
    const olderEnd = list.length - keep;

    // pinned (action, observation) 原子对移出折叠区——孤儿 observation 会破坏 i-1 配对解析（recall/hint/pin 全依赖）。
    // 配对 action 在折叠区内必居 foldable 末位；在 seed 前缀内则不动（前缀本就保真）。
    const pinned: LlmMessage[] = [];
    const foldable: LlmMessage[] = [];
    let pinnedPairs = 0;
    for (let i = base; i < olderEnd; i++) {
      if (isPinnedObservation(list, i)) {
        if (i > base) pinned.push(foldable.pop()!);
        pinned.push(list[i]!);
        pinnedPairs++;
        continue;
      }
      foldable.push(list[i]!);
    }
    if (foldable.length === 0) {
      return this.logger.debug(
        `skip (run ${ctx.runId}): older region all pinned (${pinnedPairs} pair(s)), nothing to fold`,
      );
    }

    try {
      const recap = await fold({
        llm: this.llm,
        messages: foldable,
        windowSize: compaction.windowSize,
        signal: ctx.signal,
        prompt: SNAPSHOT_PROMPT,
        modelId: compaction.modelId ?? ctx.runtimeConfig.model?.modelId,
      });
      if (!recap) {
        this.logger.warn(
          `fold returned no recap (run ${ctx.runId}): older=${foldable.length} msgs left uncompacted`,
        );
        return;
      }

      // 原地 splice(而非重绑定)——调用方持有的 messages 引用保持可见
      const folded: LlmMessage[] = [
        ...list.slice(0, base),
        {
          role: 'user',
          content: `Observation: [earlier steps in this turn — summarized]\n${recap}`,
        },
        ...pinned,
        ...recent,
      ];
      ctx.messages.splice(0, ctx.messages.length, ...folded);

      const afterTokens = estimateTokens(ctx.messages);
      this.logger.info(
        `compacted (run ${ctx.runId}): ${list.length}→${ctx.messages.length} msgs, ${beforeTokens}→${afterTokens} tokens, kept ${pinnedPairs} pinned pair(s)`,
      );

      yield {
        type: 'hook',
        hookId: this.id,
        summary: 'compacted turn history',
        data: {
          usage: {
            used: afterTokens,
            total: contextSize,
          },
        },
      };
    } catch (err) {
      this.logger.warn(
        `Iteration compaction failed: ${(err as Error)?.message ?? err}`,
      );
    }
    return;
  }
}
