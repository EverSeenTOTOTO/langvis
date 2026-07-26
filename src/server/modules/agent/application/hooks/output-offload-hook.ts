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
} from '@/server/modules/agent/domain/offload/offload-stub';

/** 产出即桩比例缺省：单条产出超 contextSize×此值 即落盘（与 query-budget maxQuerySize 同构，动态跟随窗口）。 */
const DEFAULT_OUTPUT_SIZE_RATIO = 0.2;

/**
 * post-observation 逐条桩：最后一条 Observation（或裸 user / assistant，实际此相位末条恒为 Observation）超阈值即落盘。
 * 阈值动态——contextSize×outputSizeRatio（大窗口放宽、小窗口收紧，与 query-budget 同源推导）；
 * outputTokenThreshold 若设则绝对覆盖。与 pre-LLM OffloadHook 划界——此 hook 按「单条大小」桩（大就卸），OffloadHook 按「整窗压力」桩（满了卸）。
 * 已桩（OFFLOADED_MARK）/ recall 回取（fc→fc 别名风险，仅 observation）→ 不动。
 * 读端 hint 复用 offload-stub.stubContent，与 OffloadHook 一致。
 */
@agentHook
export class OutputOffloadHook implements Hook {
  readonly id = 'output-offload';
  readonly phase: HookPhase = 'post-observation';
  private readonly logger = Logger.child({ source: 'OutputOffloadHook' });

  constructor(
    @inject(ProviderService)
    private readonly providerService: ProviderService,
  ) {}

  async *apply(ctx: AgentRunContext): AsyncGenerator<RunEvent, HookDirective> {
    const cfg = ctx.config.runtimeConfig.offload as OffloadConfig | undefined;
    if (!cfg) return 'next';

    // 动态阈值：outputTokenThreshold 绝对覆盖，否则 contextSize×outputSizeRatio（与 query-budget 同构）。
    const threshold =
      cfg.outputTokenThreshold ??
      Math.floor(
        (this.providerService.resolveContextSize(ctx.config.runtimeConfig) ??
          0) * (cfg.outputSizeRatio ?? DEFAULT_OUTPUT_SIZE_RATIO),
      );
    if (threshold <= 0) return 'next';

    const messages = ctx.messages.toArray();
    const last = messages.length - 1;
    if (last < 0) return 'next';

    const cand = candidateBody(messages[last]!);
    if (!cand) return 'next';
    if (cand.body.includes(OFFLOADED_MARK)) return 'next';

    // 配对 assistant 一次性解析：recall 判定 + hint 共用，免双重 parse。
    const paired = parseAssistantAt(messages, last - 1);
    // recall 回取（cat/rg 已 offload 句柄）→ 再落盘只 fc→fc 别名 → 跳过（仅 observation 有此风险）。
    if (cand.kind === 'observation' && classifyRecallParsed(paired) !== null)
      return 'next';

    const bodyTokens = estimateTokens([messages[last]!]);
    if (bodyTokens <= threshold) return 'next';

    const hint =
      cand.kind === 'observation'
        ? hintForObservation(messages, last, paired)
        : cand.kind === 'assistant'
          ? hintFromAction(cand.parsed)
          : hintForUser(cand.body);
    const stub = await ctx.cache.offload(ctx.workDir, cand.body, hint);
    messages[last] = {
      ...messages[last]!,
      content: stubContent(cand, stub, hint),
    };
    ctx.messages = ListMonad.of(messages);

    this.logger.info(
      `output offloaded (run ${ctx.runId}): ~${bodyTokens} tokens > ${threshold} threshold → filed ${stub.$cached}`,
    );
    yield {
      type: 'hook',
      hookId: this.id,
      summary: `filed large output (~${bodyTokens} tokens) to disk`,
      data: { filename: stub.$cached, size: stub.$size },
    };
    return 'next';
  }
}
