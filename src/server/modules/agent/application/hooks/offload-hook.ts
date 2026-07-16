import { inject } from 'tsyringe';
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
const OFFLOADED_MARK = '[offloaded to file'; // 已桩标记 → 跳过重复桩
const READ_SLICE_MARK = '[read offset='; // cached_read 页脚 → 跳过（防 offload↔read 死环）
const HEAD_KEEP = 256; // 裸 user 桩化保留头部（保 skill 触发 / 元信息）
const MIN_BODY_TO_OFFLOAD = 512; // 桩文本须明显小于原文才省
const CHUNK_SIZE = 2000; // cached_read 块大小；桩里固化首块 offset/limit，小模型照抄

/**
 * pre-LLM 体积护栏：per-call 安全网，不缩历史。只在 [base,len) 桩化，**永不碰 [0,base) seed**
 * （稳定前缀，动则破缓存、逼重读主指令）。两条独立触发：
 *   - per-message：单条正文 > contextSize×maxMessageSize → 桩它自己（单 query 不被一条主导）。
 *   - hard-cap：total×factor > contextSize−responseReserve → 最胖优先桩到窗内。
 * read-slice（含 READ_SLICE_MARK）不桩——断 offload→桩slice→重读→offload 环；最坏溢出失败（有限）。
 * 省略 fragment 即关。
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
    const factor = cfg.estimateSafetyFactor ?? 1.1;
    const hardCap = contextSize - (cfg.responseReserve ?? 512);
    const maxMsg = contextSize * (cfg.maxMessageSize ?? 0.4);

    const messages = ctx.messages.toArray();
    const len = messages.length;
    const base = ctx.base;
    const beforeTokens = estimateTokens(messages);

    // 候选：仅 [base,len)。已桩 / read-slice / 短于 MIN 跳过。最胖优先（tokens 降序）。
    const candByIndex = new Map<
      number,
      { body: string; isObservation: boolean; tokens: number }
    >();
    const ordered: number[] = [];
    for (let i = base; i < len; i++) {
      const cand = candidateBody(messages[i]!);
      if (!cand) continue;
      if (cand.body.includes(OFFLOADED_MARK)) continue;
      if (cand.body.includes(READ_SLICE_MARK)) continue;
      if (cand.body.length < MIN_BODY_TO_OFFLOAD) continue;
      candByIndex.set(i, { ...cand, tokens: estimateTokens([messages[i]!]) });
      ordered.push(i);
    }
    ordered.sort(
      (a, b) => candByIndex.get(b)!.tokens - candByIndex.get(a)!.tokens,
    );

    let stubbed = 0;

    const stubIndex = async (i: number) => {
      const c = candByIndex.get(i);
      if (!c) return;
      const msg = messages[i]!;
      const hint = c.isObservation
        ? hintForObservation(messages, i)
        : hintForUser(c.body);
      const stub = await ctx.cache.offload(ctx.workDir, c.body, hint);
      messages[i] = { ...msg, content: stubContent(c, stub, hint) };
      stubbed++;
      candByIndex.delete(i);
    };

    // per-message：单条 > maxMsg 即桩，不论总量。
    for (const i of ordered) {
      const c = candByIndex.get(i);
      if (!c) continue;
      if (c.tokens * factor <= maxMsg) continue;
      await stubIndex(i);
    }

    // hard-cap：总量逼近窗口时最胖优先桩到 hardCap 内。
    let tokens = estimateTokens(messages);
    for (const i of ordered) {
      if (tokens * factor <= hardCap) break;
      const c = candByIndex.get(i);
      if (!c) continue;
      await stubIndex(i);
      tokens = estimateTokens(messages);
    }

    if (stubbed === 0) return 'next';

    ctx.messages = ListMonad.of(messages);
    const afterTokens = estimateTokens(ctx.messages.toArray());
    this.logger.info(
      `offloaded (run ${ctx.runId}): ${stubbed} msg, ${beforeTokens}→${afterTokens} tokens`,
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

/** 桩正文：Observation 全替（保前缀 + hint 含 tool）；裸 user 保 HEAD_KEEP 头部。固化首块 offset/limit。 */
function stubContent(
  candidate: { body: string; isObservation: boolean },
  stub: { $cached: string; $size: number },
  hint: string,
): string {
  const chunks = Math.ceil(stub.$size / CHUNK_SIZE) || 1;
  const marker =
    `${OFFLOADED_MARK} ${stub.$cached}] ${hint ? `(${hint}) ` : ''}size=${stub.$size}B` +
    ` (~${chunks} chunks of ${CHUNK_SIZE}B). Retrieve via:` +
    ` cached_read(key="${stub.$cached}", offset=0, limit=${CHUNK_SIZE})` +
    ` — next chunk: offset=${CHUNK_SIZE}`;
  if (candidate.isObservation) {
    return `${OBSERVATION_PREFIX}${marker}`;
  }
  return `${candidate.body.slice(0, HEAD_KEEP)}\n${marker}`;
}

/** user-role 候选正文：Observation 去前缀；裸 user 取全文。非 user → null。 */
function candidateBody(
  msg: LlmMessage,
): { body: string; isObservation: boolean } | null {
  if (msg.role !== 'user') return null;
  if (msg.content.startsWith(OBSERVATION_PREFIX)) {
    return {
      body: msg.content.slice(OBSERVATION_PREFIX.length),
      isObservation: true,
    };
  }
  return { body: msg.content, isObservation: false };
}

/** Observation 的 hint：配对 assistant 的 tool + 首个 scalar 入参。失败 → ''。 */
function hintForObservation(messages: LlmMessage[], obsIndex: number): string {
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

/** 裸 user 的 hint：正文首行作 label。 */
function hintForUser(body: string): string {
  const firstLine = body.split('\n')[0]?.trim() ?? '';
  return firstLine.slice(0, 32);
}

function firstScalar(input: Record<string, unknown>): string | null {
  for (const v of Object.values(input)) {
    if (typeof v === 'string' && v.length > 0) return v.slice(0, 32);
    if (typeof v === 'number') return String(v);
  }
  return null;
}
