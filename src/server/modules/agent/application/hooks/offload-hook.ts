import { inject } from 'tsyringe';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type {
  Hook,
  HookDirective,
  HookPhase,
} from '@/server/modules/agent/domain/model/hook';
import type { RunEvent } from '@/shared/types/events';
import { ListMonad } from '@/server/libs/list';
import { estimateTokens } from '@/server/utils/estimateTokens';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import type { OffloadConfig } from '@/server/libs/config/fragments/offload';
import Logger from '@/server/utils/logger';
import { agentHook } from './registry';
import { classifyRecallParsed } from '@/server/modules/agent/domain/offload/offload-recall';
import {
  candidateBody,
  stubContent,
  hintFromAction,
  hintForObservation,
  hintForUser,
  parseAssistantAt,
  OFFLOADED_MARK,
  CHUNK_SIZE,
  type Candidate,
} from '@/server/modules/agent/domain/offload/offload-stub';
import type { ParsedAction } from '@/server/modules/agent/domain/port/agent-run-context.port';

/** estimateTokens 对中文/JSON 系统性低估 ~8% 的固定补偿（非旋钮）——防桩化不足→真实爆窗。 */
const ESTIMATE_SAFETY_FACTOR = 1.1;
/** 总量触发比例缺省：total×factor > contextWindow×此值即 offload 最胖。 */
const DEFAULT_WINDOW_RATIO = 0.8;

/**
 * 当本次 query 的 token×factor > contextWindow×windowRatio（剩余空间不足）时，最胖优先桩化 [base,len) 内候选到盘（bash rg/sed/head 句柄），直到缩进阈值内。
 */
@agentHook
export class OffloadHook implements Hook {
  readonly id = 'offload';
  readonly phase: HookPhase = 'pre-llm';
  private readonly logger = Logger.child({ source: 'OffloadHook' });

  constructor(
    @inject(ProviderService)
    private readonly providerService: ProviderService,
  ) {}

  async *apply(ctx: AgentRunContext): AsyncGenerator<RunEvent, HookDirective> {
    const cfg = ctx.config.runtimeConfig.offload as OffloadConfig | undefined;
    if (!cfg) return 'next';

    const contextSize = this.providerService.resolveContextSize(
      ctx.config.runtimeConfig,
    );
    if (!contextSize) return 'next';

    // factor 放大估算，吸收 estimateTokens 对中文/JSON 的系统性低估（防桩化不足→真实爆窗）。
    const factor = ESTIMATE_SAFETY_FACTOR;
    const cap = contextSize * (cfg.windowRatio ?? DEFAULT_WINDOW_RATIO);

    const messages = ctx.messages.toArray();
    const len = messages.length;
    const base = ctx.base;
    let tokens = estimateTokens(messages);
    if (tokens * factor <= cap) return 'next';

    // 候选：仅 [base,len)。已桩 / 盘上句柄回取 / 短于 MIN 跳过。最胖优先（tokens 降序）。
    // assistant 的 ParsedAction 单一索引：candidateBody 解析后寄存于此，供该 assistant 作为
    // 候选自身的 hint/stub、以及作为下一条 observation 的配对源（recall + hint）共用——免重复 parse。
    const parsedByIndex = new Map<number, ParsedAction | null>();
    const parsedAt = (i: number): ParsedAction | null => {
      if (!parsedByIndex.has(i)) {
        parsedByIndex.set(i, parseAssistantAt(messages, i));
      }
      return parsedByIndex.get(i)!;
    };
    const candByIndex = new Map<number, { cand: Candidate; tokens: number }>();
    const ordered: number[] = [];
    for (let i = base; i < len; i++) {
      const cand = candidateBody(messages[i]!);
      if (!cand) continue;
      // assistant 候选已由 candidateBody 解析——寄存进单一索引，供下游 observation 复用，免再 parse。
      if (cand.kind === 'assistant') parsedByIndex.set(i, cand.parsed);
      if (cand.body.includes(OFFLOADED_MARK)) continue;
      // 仅 observation 有 fc→fc 别名风险（assistant 桩重建为 {_offloaded}，无回取螺旋）。
      if (
        cand.kind === 'observation' &&
        classifyRecallParsed(parsedAt(i - 1)) !== null
      )
        continue;
      // 原文短于一个 chunk → 桩文本不会明显小于原文，不桩。
      if (cand.body.length < CHUNK_SIZE) continue;
      candByIndex.set(i, { cand, tokens: estimateTokens([messages[i]!]) });
      ordered.push(i);
    }
    ordered.sort(
      (a, b) => candByIndex.get(b)!.tokens - candByIndex.get(a)!.tokens,
    );

    let stubbed = 0;
    let totalBytes = 0;
    const beforeTokens = tokens;

    const stubIndex = async (i: number) => {
      const entry = candByIndex.get(i);
      if (!entry) return;
      const { cand } = entry;
      const msg = messages[i]!;
      const hint =
        cand.kind === 'observation'
          ? hintForObservation(messages, i, parsedAt(i - 1))
          : cand.kind === 'assistant'
            ? hintFromAction(cand.parsed)
            : hintForUser(cand.body);
      const stub = await ctx.cache.offload(ctx.workDir, cand.body, hint);
      messages[i] = { ...msg, content: stubContent(cand, stub, hint) };
      stubbed++;
      totalBytes += stub.$size;
      candByIndex.delete(i);
      tokens = estimateTokens(messages);
    };

    // 最胖优先桩到 cap 内（total×factor）。
    for (const i of ordered) {
      if (tokens * factor <= cap) break;
      await stubIndex(i);
    }

    if (stubbed === 0) return 'next';

    ctx.messages = ListMonad.of(messages);
    const afterTokens = estimateTokens(ctx.messages.toArray());
    this.logger.info(
      `offloaded (run ${ctx.runId}): ${stubbed} msg, ${beforeTokens}→${afterTokens} tokens (window cap ${cap})`,
      { stubbed, totalBytes, beforeTokens, afterTokens, cap },
    );

    yield {
      type: 'hook',
      hookId: this.id,
      summary: `offloaded ${stubbed} message(s) to disk`,
      data: {
        usage: { used: afterTokens, total: contextSize },
        offloaded: stubbed,
      },
    };
    return 'next';
  }
}
