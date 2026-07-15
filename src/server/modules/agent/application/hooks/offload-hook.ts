import { injectable, inject } from 'tsyringe';
import type { AgentRunContext } from '@/server/modules/agent/domain/port/agent-run-context.port';
import type {
  Hook,
  HookDirective,
  HookPhase,
} from '@/server/modules/agent/domain/model/hook';
import type { RunEvent } from '@/shared/types/events';
import type { LlmMessage } from '@/shared/types/entities';
import { ListMonad } from '@/server/libs/list';
import { estimateTokens } from '@/server/utils/estimateTokens';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import { parseResponse } from '@/server/modules/agent/application/service/react-loop';
import type { OffloadConfig } from '@/server/libs/config/fragments/offload';
import Logger from '@/server/utils/logger';
import { agentHook } from './registry';

const OBSERVATION_PREFIX = 'Observation: ';
/** 已桩化的正文含此标记 → 跳过，避免重复桩化。 */
const OFFLOADED_MARK = '[offloaded to file';
/** 正文短于此不桩（桩本身有固定开销，桩它反变大）。 */
const MIN_BODY_TO_OFFLOAD = 256;

/**
 * 预算化无损 offload：post-observation 测 token，超 contextSize×threshold 时把最老的
 * 未桩化 Observation 载荷写盘、正文换桩，直到回 hardCap 内或无可桩。LRU 保护最近 keepRecent
 * 条（模型下轮要消费、cached_read 刚读回的不被再桩）。桩文本 in-band 暴露文件名 + rg/cached_read
 * 检索路径——根治 cat-fc_ 反模式。与 loop fold 正交：本 hook import 在前 → 无损先于有损。
 *
 * 仅作用于单 run 内（messages[base..]）。跨 turn 历史（seed assistant 已被 conv 层 summary 化）
 * 不归本 hook，回溯到的 assistant 必是模型原文 {tool,input}，parseResponse 可靠还原。
 */
@injectable()
@agentHook
export class OffloadHook implements Hook {
  readonly id = 'offload';
  readonly phase: HookPhase = 'post-observation';
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

    // estimateTokens(cl100k) 对中文/JSON 系统性低估（实测 8K 模型低估 ~8%），
    // 直接用于预算判断会桩化不足、真实爆窗。乘 safetyFactor 放大估算，让桩化更激进、
    // 吸收低估。仅本 hook 内用——peak_ctx/loop-usage 仍报原 estimateTokens（语义不变）。
    const factor = cfg.estimateSafetyFactor ?? 1.1;
    const hardCap = contextSize - (cfg.responseReserve ?? 512);
    let tokens = estimateTokens(ctx.messages.toArray());
    if (tokens * factor <= contextSize * cfg.threshold) return 'next';

    const messages = ctx.messages.toArray();
    const keepRecent = cfg.keepRecent ?? 4;
    // 可桩区间 = loop 内、去掉最近 keepRecent 条。
    const lowerBound = ctx.base;
    const upperBound = Math.max(lowerBound, messages.length - keepRecent);
    let offloaded = 0;

    for (let i = lowerBound; i < upperBound && tokens * factor > hardCap; i++) {
      const msg = messages[i]!;
      const body = observationBody(msg);
      if (body === null) continue; // 非 Observation
      if (body.includes(OFFLOADED_MARK)) continue; // 已桩
      if (body.length < MIN_BODY_TO_OFFLOAD) continue; // 太小不值

      const hint = hintFor(messages, i);
      const stub = await ctx.cache.offload(ctx.workDir, body, hint);
      messages[i] = {
        ...msg,
        content: `${OBSERVATION_PREFIX}${OFFLOADED_MARK} ${stub.$cached}] ${
          hint ? `(${hint}) ` : ''
        }size=${stub.$size}B. Retrieve via: rg "<pattern>" ${stub.$cached} | cached_read(key="${stub.$cached}", offset, limit)`,
      };
      offloaded++;
      tokens = estimateTokens(messages);
    }

    if (offloaded === 0) return 'next';

    ctx.messages = ListMonad.of(messages);
    const afterTokens = estimateTokens(ctx.messages.toArray());
    this.logger.info(
      `offloaded (run ${ctx.runId}): ${offloaded} obs, ${tokens}→${afterTokens} tokens`,
    );

    yield {
      type: 'hook',
      hookId: this.id,
      summary: `offloaded ${offloaded} observation(s) to disk`,
      data: { usage: { used: afterTokens, total: contextSize }, offloaded },
    };
    return 'next';
  }
}

/** 取 user-role Observation 正文（去前缀）；非 Observation / 非 user 返回 null。 */
function observationBody(msg: LlmMessage): string | null {
  if (msg.role !== 'user') return null;
  if (!msg.content.startsWith(OBSERVATION_PREFIX)) return null;
  return msg.content.slice(OBSERVATION_PREFIX.length);
}

/**
 * 从配对 assistant 消息（Observation 紧前那条）parseResponse 取 tool + 第一个 scalar
 * 入参，拼语义 hint（进文件名 + 桩标签）。parseResponse 抛 / 无 assistant → 退 ''。
 */
function hintFor(messages: LlmMessage[], obsIndex: number): string {
  const assistant = messages[obsIndex - 1];
  if (!assistant || assistant.role !== 'assistant') return '';
  try {
    const { tool, input } = parseResponse(assistant.content);
    const scalar = firstScalar(input);
    return scalar ? `${tool}-${scalar}` : tool;
  } catch {
    return '';
  }
}

function firstScalar(input: Record<string, unknown>): string | null {
  for (const v of Object.values(input)) {
    if (typeof v === 'string' && v.length > 0) return v.slice(0, 32);
    if (typeof v === 'number') return String(v);
  }
  return null;
}
