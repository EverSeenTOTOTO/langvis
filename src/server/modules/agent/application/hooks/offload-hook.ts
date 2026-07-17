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
/** estimateTokens 对中文/JSON 系统性低估 ~8% 的固定补偿（非旋钮）——防桩化不足→真实爆窗。 */
const ESTIMATE_SAFETY_FACTOR = 1.1;
/** 总量触发比例缺省：total×factor > contextWindow×此值即 offload 最胖。 */
const DEFAULT_WINDOW_RATIO = 0.9;

/**
 * pre-LLM **无损**体积护栏：per-call 安全网，不缩历史，**总量/窗口空间口径**（与 QueryBudgetHook 无关）。
 * 当本次 query 的 token×factor > contextWindow×windowRatio（剩余空间不足）时，最胖优先桩化 [base,len)
 * 内候选到盘（cached_read/rg 句柄），直到缩进阈值内。QueryBudgetHook 是 per-latest 单条口径
 * （阈值在 guard.maxQuerySize，drop 最新一条）——两 hook 维度不同、阈值不同、各自独立。
 *
 * 总量逼近窗口主要由 compaction（post-observation fold，阈值 0.8）缩；本 hook 是 compaction 之后的
 * 无损兜底——compaction 缩不下（read-slice 被 skip、base 自身超窗）时才大量介入。
 * read-slice（含 READ_SLICE_MARK）不桩——断 offload→桩slice→重读→offload 环；最坏溢出失败（有限）。
 * 永不碰 [0,base) seed（稳定前缀，动则破缓存、逼重读主指令）。省略 offload fragment 即关。
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
    const beforeTokens = tokens;

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

/** 桩正文：Observation 全替（保前缀 + hint 含 tool）；裸 user 保 HEAD_KEEP 头部。固化首块 offset/limit。
 *  访问指引自门控：有 bash 则优先 rg 按需检索（落盘文件即 workDir 下 filename，bash cwd=workDir 可直读），
 *  否则退回 cached_read 线性分页——agent 据 system prompt 自知有无 bash，无须 hook 探测 toolSet。 */
function stubContent(
  candidate: { body: string; isObservation: boolean },
  stub: { $cached: string; $size: number },
  hint: string,
): string {
  const chunks = Math.ceil(stub.$size / CHUNK_SIZE) || 1;
  const fn = stub.$cached;
  const marker =
    `${OFFLOADED_MARK} ${fn}] ${hint ? `(${hint}) ` : ''}size=${stub.$size}B` +
    ` (~${chunks} chunks of ${CHUNK_SIZE}B). The full content is saved as file ${fn} in your workDir;` +
    ` if bash is available, search on demand, e.g. rg -n "<keyword>" -C 3 ${fn} (or grep/sed),` +
    ` instead of loading the whole file; otherwise page sequentially via` +
    ` cached_read(key="${fn}", offset=0, limit=${CHUNK_SIZE}) — next chunk: offset=${CHUNK_SIZE}`;
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
