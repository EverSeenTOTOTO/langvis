/** 从 EnrichedEvent[] 派生 efficiency / design 两轴（域无关）。 */
import type { EnrichedEvent } from '@/shared/types/events';
import { extractJsonObject } from '@/shared/utils';
import type { LlmMessage } from '@/shared/types/entities';
import { PARSE_ERROR_OBSERVATION_PREFIX } from '@/server/modules/agent/application/service/react-loop';
import type {
  DesignMetrics,
  EfficiencyMetrics,
  ParseFailure,
  ParseFailureMode,
} from './types';

type LoopUsage = Extract<EnrichedEvent, { type: 'loop_usage' }>;
type ToolCallEvt = Extract<EnrichedEvent, { type: 'tool_call' }>;
type ToolErrorEvt = Extract<EnrichedEvent, { type: 'tool_error' }>;
type HookEvt = Extract<EnrichedEvent, { type: 'hook' }>;

export function deriveEfficiency(
  events: readonly EnrichedEvent[],
): EfficiencyMetrics {
  const toolCalls = events.filter(
    (e): e is ToolCallEvt => e.type === 'tool_call',
  ).length;
  const loopUsage = events.filter(
    (e): e is LoopUsage => e.type === 'loop_usage',
  );
  const peakContext = loopUsage.reduce((m, e) => Math.max(m, e.used), 0);
  const cumulativeCostProxy = loopUsage.reduce((s, e) => s + e.used, 0);
  const first = events[0]?.at ?? 0;
  const last = events[events.length - 1]?.at ?? first;
  return {
    iterations: toolCalls,
    toolCalls,
    peakContext,
    cumulativeCostProxy,
    durationMs: last - first,
  };
}

export function deriveDesign(events: readonly EnrichedEvent[]): DesignMetrics {
  const errors = events.filter(
    (e): e is ToolErrorEvt => e.type === 'tool_error',
  );
  const errorTools = [...new Set(errors.map(e => e.toolName))];
  const hookIds = new Set(
    events.filter((e): e is HookEvt => e.type === 'hook').map(e => e.hookId),
  );
  const compactionTriggers = events.filter(
    e => e.type === 'hook' && e.hookId === 'compaction',
  ).length;

  const counts = new Map<string, number>();
  for (const e of events) {
    if (e.type !== 'tool_call') continue;
    const key = `${e.toolName}:${JSON.stringify(e.toolArgs)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const redundantCalls = counts.size ? Math.max(...counts.values()) : 0;

  return {
    toolErrors: errors.length,
    errorTools,
    compactionTriggers,
    budgetHit: hookIds.has('cumulative-budget'),
    stuckHit: hookIds.has('stuck'),
    iterationCapHit: hookIds.has('max-iterations'),
    redundantCalls,
  };
}

// ─── parse 失败扫描（直读 ctx.messages，不耦合 loopUsage 相位语义） ───

/** refine "missing or invalid top-level tool/input" → 结构模式：查第一对象有没有 tool，其后是否还有 `{`。 */
function refineMissingOrInvalid(raw: string): ParseFailureMode {
  let firstObj: string;
  try {
    firstObj = extractJsonObject(raw);
  } catch {
    return 'other';
  }
  let obj: { tool?: unknown; input?: unknown };
  try {
    obj = JSON.parse(firstObj);
  } catch {
    return 'malformed-json';
  }
  const hasTool = typeof obj.tool === 'string' && obj.tool.length > 0;
  const hasInput = obj.input !== null && typeof obj.input === 'object';
  if (!hasTool) {
    const after = raw.slice(raw.indexOf(firstObj) + firstObj.length);
    return after.includes('{') ? 'split-object' : 'missing-tool';
  }
  return hasInput ? 'other' : 'missing-input';
}

function classifyMode(raw: string, reason: string): ParseFailureMode {
  if (reason.includes('Invalid response: missing or invalid')) {
    return refineMissingOrInvalid(raw);
  }
  if (reason.includes('no JSON object')) return 'no-json';
  if (reason.includes('unbalanced')) return 'unbalanced';
  if (
    reason.includes('is not valid JSON') ||
    reason.includes('Unexpected token') ||
    reason.includes('in JSON')
  ) {
    return 'malformed-json';
  }
  return 'other';
}

/**
 * 扫 run 末态 messages：每条以 PARSE_ERROR_OBSERVATION_PREFIX 开头的 user 消息 = 一次 parse
 * 失败；其紧邻前一条 assistant content = 模型那段坏输出原文。mode 由 reason + raw 共同判定。
 *
 * 直接读 ctx.messages（事实源）——parse 失败已在 react-loop catch 里回灌为这条 Observation，
 * 无需新增 RunEvent，也无需 loopUsage 算术代理。
 */
export function extractParseFailures(
  messages: readonly LlmMessage[],
): ParseFailure[] {
  const out: ParseFailure[] = [];
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]!;
    if (m.role !== 'user') continue;
    if (!m.content.startsWith(PARSE_ERROR_OBSERVATION_PREFIX)) continue;
    const reason = m.content.slice(PARSE_ERROR_OBSERVATION_PREFIX.length);
    const prev = messages[i - 1];
    const raw = prev && prev.role === 'assistant' ? prev.content : '';
    out.push({ mode: classifyMode(raw, reason), raw, reason });
  }
  return out;
}
