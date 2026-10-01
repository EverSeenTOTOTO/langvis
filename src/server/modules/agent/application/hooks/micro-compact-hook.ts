import { Inject } from '@nestjs/common';
import { ToolIds } from '@/shared/constants';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { ParsedAction } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type { Hook, HookPhase } from '@/server/modules/agent/domain/model/hook';
import type { RunEvent } from '@/shared/types/events';
import { ProviderService } from '@/server/infrastructure/provider.service';
import type { OffloadConfig } from '@/server/modules/conversation/domain/config/fragments/offload';
import Logger from '@/server/utils/logger';
import {
  OBSERVATION_PREFIX,
  OFFLOADED_MARK,
  fcIdFromStub,
  parseAssistantAt,
} from '@/server/modules/agent/domain/offload/offload-stub';

/** 微压缩启用门槛：run 步数达此值才丢弃旧桩（仅长 run 触发有损清理）。 */
const DEFAULT_COMPACT_STEP_THRESHOLD = 20;
/** 微压缩丢弃年龄（tick）：仅满此年龄的 observation 桩被丢弃；须 > trimAge。 */
const DEFAULT_COMPACT_AGE = 8;
/** 近窗口保护：末 keepRecent 条消息微压缩不碰。 */
const DEFAULT_KEEP_RECENT = 4;

// 微压缩（pre-LLM）：步数驱动的有损清理。run 步数达 compactStepThreshold 后，满 compactAge 个 tick 且未被后续 bash 回取
// 的 observation 桩有损丢弃——长 run 下盘上内容已不再被引用，主动清除旧工具结果以减负。assistant 桩/seed/近窗口不动；磁盘文件不删（CachePort 仅写端）。
export class MicroCompactHook implements Hook {
  readonly id = 'micro-compact';
  readonly phase: HookPhase = 'pre-llm';
  private readonly logger = Logger.child({ source: 'MicroCompactHook' });

  constructor(
    @Inject(ProviderService)
    private readonly providerService: ProviderService,
  ) {}

  async *apply(ctx: AgentRunContext): AsyncGenerator<RunEvent, void> {
    const cfg = ctx.config.runtimeConfig.offload as OffloadConfig | undefined;
    if (!cfg)
      return this.logger.debug(`skip (run ${ctx.runId}): offload config off`);

    const stepThreshold =
      cfg.compactStepThreshold ?? DEFAULT_COMPACT_STEP_THRESHOLD;
    const compactAge = cfg.compactAge ?? DEFAULT_COMPACT_AGE;
    const keepRecent = cfg.keepRecent ?? DEFAULT_KEEP_RECENT;

    const messages = ctx.messages;
    const len = messages.length;
    const base = ctx.base;

    // 步数 = [base,len) 内 Observation 数（≈ run tick 数）。
    let steps = 0;
    for (let i = base; i < len; i++) {
      const m = messages[i]!;
      if (m.role === 'user' && m.content.startsWith(OBSERVATION_PREFIX))
        steps++;
    }
    if (steps < stepThreshold)
      return this.logger.debug(
        `skip (run ${ctx.runId}): steps ${steps} < threshold ${stepThreshold}`,
      );

    // age(i) = i 之后的 assistant 消息数（与 TrimHook 同口径）。
    const age = new Array<number>(len);
    let suffix = 0;
    for (let i = len - 1; i >= 0; i--) {
      age[i] = suffix;
      if (messages[i]!.role === 'assistant') suffix++;
    }

    const drop: number[] = [];
    for (let i = base; i < len; i++) {
      if (i >= len - keepRecent) break; // 近窗口保护
      const m = messages[i]!;
      if (m.role !== 'user' || !m.content.startsWith(OBSERVATION_PREFIX))
        continue;
      if (!m.content.includes(OFFLOADED_MARK)) continue; // 仅丢桩
      if (age[i]! < compactAge) continue; // 不够老
      const fcId = fcIdFromStub(m.content);
      // 后续 bash 回取过该句柄 → 仍在用 → 保留；未被回取 → 旧工具结果，丢弃。
      if (fcId && isRecalledLater(messages, i, fcId)) continue;
      drop.push(i);
    }

    if (drop.length === 0) {
      this.logger.debug(
        `nothing to micro-compact (run ${ctx.runId}): steps ${steps}, compactAge ${compactAge}`,
      );
      return;
    }

    // 从后往前 splice（保未处理索引有效）。
    for (let k = drop.length - 1; k >= 0; k--) messages.splice(drop[k]!, 1);
    ctx.messages = messages;

    const contextSize =
      this.providerService.resolveContextSize(ctx.config.runtimeConfig) ?? 0;
    this.logger.info(
      `micro-compacted (run ${ctx.runId}): dropped ${drop.length} aged stub(s) (steps ${steps})`,
      { dropped: drop.length, steps },
    );
    yield {
      type: 'hook',
      hookId: this.id,
      summary: `dropped ${drop.length} aged tool-result stub(s)`,
      data: {
        usage: { used: 0, total: contextSize },
        dropped: drop.length,
      },
    };
    return;
  }
}

// 该 stub 之后是否有 bash 命令引用其 fc 句柄（回取）——被回取过的桩仍可能在用，保留。
function isRecalledLater(
  messages: AgentRunContext['messages'],
  i: number,
  fcId: string,
): boolean {
  for (let j = i + 1; j < messages.length; j++) {
    if (messages[j]!.role !== 'assistant') continue;
    const parsed: ParsedAction | null = parseAssistantAt(messages, j);
    if (parsed?.tool !== ToolIds.BASH) continue;
    const cmd = (parsed.input as { command?: unknown }).command;
    if (typeof cmd === 'string' && cmd.includes(fcId)) return true;
  }
  return false;
}
