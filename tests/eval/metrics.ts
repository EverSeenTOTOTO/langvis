/** 从 EnrichedEvent[] 派生 efficiency / design 两轴（域无关）。 */
import type { EnrichedEvent } from '@/shared/types/events';
import type { DesignMetrics, EfficiencyMetrics } from './types';

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
