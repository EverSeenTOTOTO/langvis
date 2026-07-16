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
/** 已桩化的正文含此标记 → 跳过，避免重复桩化。 */
const OFFLOADED_MARK = '[offloaded to file';
/** 裸 user 消息桩化时保留的正文头部（保住 email 指令 / 元信息 / skill 触发 token）。 */
const HEAD_KEEP = 256;
/** 正文短于此不桩：桩文本（head 256 + 标记 ~150）须明显小于原文才省 token。 */
const MIN_BODY_TO_OFFLOAD = 512;
/** cached_read 建议块大小（字符）。桩里固化首块 offset=0/limit=CHUNK，小模型照抄即可，
 *  无需自算数值——根治"裸读全文→再 offload"套娃。读回的续读 offset 由 cached_read 页脚给。 */
const CHUNK_SIZE = 2000;

/**
 * pre-LLM 预算化无损落盘（offload）。每次 LLM 调用前测 token，超 contextSize×threshold 时
 * 把 user 消息载荷（Observation 或裸 user，如 email 正文）写盘、正文换桩，直到回 hardCap 内或无可桩。
 *
 * 两阶段范围（保供应商前缀缓存）：
 *   A 阶段 [base, len)：loop 内 oldest-first 桩。seed [0, base) 不动 → 跨 turn 字节前缀缓存有效。
 *   B 阶段 [0, base)：仅当 A 耗尽仍超 hardCap（seed 自身溢出，如 email 大正文）才回溯进 seed 桩。
 * 阈值门控保底：未超阈直接 return，两阶段都不进 → 常见情况零开销、缓存无损。
 *
 * keepRecent 软偏好：不硬截断最近 N 条。oldest-first 自然优先吃老的；耗尽优选区仍超 hardCap
 * 才推到保护段（warn 标记）。recent Observations 优先于 seed 被桩（seed 是跨 turn 缓存前缀，更值钱）。
 *
 * 谓词：任意 user-role 消息（Observation 去 `Observation: ` 前缀、裸 user 取全文）、正文 ≥ MIN、
 * 未含 OFFLOADED_MARK。assistant/system 不桩。Observation 桩全替（hint 已含 tool）；裸 user 桩
 * 保留 HEAD_KEEP 头部（保住 `/document_archive` skill 触发 + 元信息）。桩固化具体首块
 * offset/limit + 块数——根治"裸读全文→再 offload"页抖动。
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

    // estimateTokens(cl100k) 对中文/JSON 系统性低估（实测 8K 模型低估 ~8%），
    // 直接用于预算判断会桩化不足、真实爆窗。乘 safetyFactor 放大估算，让桩化更激进、
    // 吸收低估。仅本 hook 内用——peak_ctx/loop-usage 仍报原 estimateTokens（语义不变）。
    const factor = cfg.estimateSafetyFactor ?? 1.1;
    const hardCap = contextSize - (cfg.responseReserve ?? 512);
    const beforeTokens = estimateTokens(ctx.messages.toArray());
    if (beforeTokens * factor <= contextSize * cfg.threshold) return 'next';

    const messages = ctx.messages.toArray();
    const len = messages.length;
    const base = ctx.base;
    const keepRecent = cfg.keepRecent ?? 4;

    // 桩化顺序：A 阶段 [base,len) oldest-first → B 阶段 [0,base) oldest-first（seed 兜底）。
    // keepRecent 保护段（≥ len-keepRecent）在 A 阶段尾部自然靠后；软化 = 不停在那里。
    const order: number[] = [];
    for (let i = base; i < len; i++) order.push(i);
    for (let i = 0; i < base; i++) order.push(i);

    let stubbed = 0;
    let seedStubbed = 0;
    let protectedStubbed = 0;
    let tokens = beforeTokens;

    for (const i of order) {
      if (tokens * factor <= hardCap) break;
      const msg = messages[i]!;
      const candidate = candidateBody(msg);
      if (!candidate) continue; // 非 user
      if (candidate.body.includes(OFFLOADED_MARK)) continue; // 已桩
      if (candidate.body.length < MIN_BODY_TO_OFFLOAD) continue; // 太小不值

      const hint = candidate.isObservation
        ? hintForObservation(messages, i)
        : hintForUser(candidate.body);
      const stub = await ctx.cache.offload(ctx.workDir, candidate.body, hint);
      messages[i] = {
        ...msg,
        content: stubContent(candidate, stub, hint),
      };
      stubbed++;
      if (i < base) seedStubbed++;
      if (i >= len - keepRecent) protectedStubbed++;
      tokens = estimateTokens(messages);
    }

    if (stubbed === 0) return 'next';

    ctx.messages = ListMonad.of(messages);
    const afterTokens = estimateTokens(ctx.messages.toArray());
    this.logger.info(
      `offloaded (run ${ctx.runId}): ${stubbed} msg${seedStubbed ? ` (${seedStubbed} seed-backtrack)` : ''}, ${beforeTokens}→${afterTokens} tokens`,
    );
    if (protectedStubbed > 0) {
      this.logger.warn(
        `offload breached keepRecent (run ${ctx.runId}): stubbed ${protectedStubbed} protected msg(s) — consider cached_read next round`,
      );
    }

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

/** 构造桩正文：Observation 全替（保前缀 + hint 含 tool）；裸 user 保 HEAD_KEEP 头部。
 *  固化具体首块 offset/limit + 块数——小模型照抄即拿第一块，根治裸读全文套娃。 */
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

/** 取 user-role 桩化候选正文：Observation 去 `Observation: ` 前缀；裸 user 取全文。非 user → null。 */
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

/**
 * Observation 的 hint：从配对 assistant 消息（紧前那条）parseResponse 取 tool + 第一个 scalar
 * 入参。parseResponse 抛 / 无 assistant → 退 ''。
 */
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

/** 裸 user 消息（无配对 assistant）的 hint：取正文首行规整作 label（如 /document_archive）。 */
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
