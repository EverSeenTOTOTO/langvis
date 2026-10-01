import { Inject } from '@nestjs/common';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { ParsedAction } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { Hook, HookPhase } from '@/server/modules/agent/domain/model/hook';
import type { RunEvent } from '@/shared/types/events';
import { estimateTokens } from '@/server/utils/estimateTokens';
import { ProviderService } from '@/server/infrastructure/provider.service';
import type { OffloadConfig } from '@/server/modules/conversation/domain/config/fragments/offload';
import Logger from '@/server/utils/logger';
import { classifyRecallParsed } from '@/server/modules/agent/domain/offload/offload-recall';
import { isPinnedObservation } from '@/server/modules/agent/domain/offload/pin';
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

/** 裁剪触发年龄（tick）：observation/assistant 满此年龄即桩化（无损落盘 + hint 桩）。 */
const DEFAULT_TRIM_AGE = 2;
/** 近窗口保护：末 keepRecent 条消息裁剪不碰（保最新决策所需上下文）。 */
const DEFAULT_KEEP_RECENT = 4;

// 裁剪（pre-LLM）：age 驱动的无损桩化。低价值 aged 结果满 trimAge 个 tick 即落盘 + 替换为 hint 文本标记，
// 读端经 rg/sed 回取。与体积无关，按年龄裁剪。pinned 驻留；recall 句柄副本跳过；近窗口与短正文不动。
export class TrimHook implements Hook {
  readonly id = 'trim';
  readonly phase: HookPhase = 'pre-llm';
  private readonly logger = Logger.child({ source: 'TrimHook' });

  constructor(
    @Inject(ProviderService)
    private readonly providerService: ProviderService,
  ) {}

  async *apply(ctx: AgentRunContext): AsyncGenerator<RunEvent, void> {
    const cfg = ctx.config.runtimeConfig.offload as OffloadConfig | undefined;
    if (!cfg)
      return this.logger.debug(`skip (run ${ctx.runId}): offload config off`);

    const trimAge = cfg.trimAge ?? DEFAULT_TRIM_AGE;
    const keepRecent = cfg.keepRecent ?? DEFAULT_KEEP_RECENT;

    const messages = ctx.messages;
    const len = messages.length;
    const base = ctx.base;
    if (len - base <= 0) return;

    // age(i) = i 之后的 assistant 消息数 ≈ 自该消息起经过的 tick 数（裁剪口径）。
    const age = new Array<number>(len);
    let suffix = 0;
    for (let i = len - 1; i >= 0; i--) {
      age[i] = suffix;
      if (messages[i]!.role === 'assistant') suffix++;
    }

    // assistant 的 ParsedAction 由 candidateBody 解析后寄存单一索引，配对 observation 的 recall/hint 复用，免重复 parse。
    const parsedByIndex = new Map<number, ParsedAction | null>();
    const parsedAt = (i: number): ParsedAction | null => {
      if (!parsedByIndex.has(i))
        parsedByIndex.set(i, parseAssistantAt(messages, i));
      return parsedByIndex.get(i)!;
    };

    const contextSize =
      this.providerService.resolveContextSize(ctx.config.runtimeConfig) ?? 0;
    let stubbed = 0;
    let totalBytes = 0;

    const stubIndex = async (i: number, cand: Candidate) => {
      const hint =
        cand.kind === 'observation'
          ? hintForObservation(messages, i, parsedAt(i - 1))
          : cand.kind === 'assistant'
            ? hintFromAction(cand.parsed)
            : hintForUser(cand.body);
      const stub = await ctx.cache.offload(ctx.workDir, cand.body, hint);
      messages[i] = { ...messages[i]!, content: stubContent(cand, stub, hint) };
      stubbed++;
      totalBytes += stub.$size;
    };

    for (let i = base; i < len; i++) {
      if (i >= len - keepRecent) break; // 近窗口保护
      if (age[i]! < trimAge) continue; // 不够老
      const cand = candidateBody(messages[i]!);
      if (!cand) continue;
      if (cand.kind === 'assistant') parsedByIndex.set(i, cand.parsed);
      if (cand.body.includes(OFFLOADED_MARK)) continue; // 已桩
      if (cand.kind === 'observation') {
        // 回取盘上句柄副本 → 再落盘只 fc→fc 别名 → 跳过（仅 observation 有此风险）。
        if (classifyRecallParsed(parsedAt(i - 1)) !== null) continue;
        // pinned（list_tools/skill_call 产出）不裁——参考资料须原样驻留。
        if (isPinnedObservation(messages, i, parsedAt(i - 1))) continue;
      }
      if (cand.body.length < CHUNK_SIZE) continue; // 桩文本不会明显小于原文，不桩
      await stubIndex(i, cand);
    }

    if (stubbed === 0) {
      this.logger.debug(
        `nothing to trim (run ${ctx.runId}): base=${base} len=${len} trimAge=${trimAge}`,
      );
      return;
    }

    ctx.messages = messages;
    const afterTokens = estimateTokens(ctx.messages);
    this.logger.info(
      `trimmed (run ${ctx.runId}): ${stubbed} msg stubbed to disk`,
      { stubbed, totalBytes, afterTokens },
    );
    yield {
      type: 'hook',
      hookId: this.id,
      summary: `trimmed ${stubbed} aged message(s) to hint stubs`,
      data: {
        usage: { used: afterTokens, total: contextSize },
        trimmed: stubbed,
      },
    };
    return;
  }
}
