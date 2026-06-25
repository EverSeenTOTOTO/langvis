/**
 * 记忆压缩运行时配置（从 RuntimeConfigVO.runtimeConfig.memory.compaction 读取）。
 *
 * 横跨两层：
 * - HistoryCompaction（post-turn）：enabled / threshold / windowSize
 * - IterationCompaction（loop 内）：enabled / threshold / windowSize / keepRecent
 *
 * 集中读取 + 默认值，供 loop 与 complete-turn.handler 共用，避免分散硬编码。
 */
export interface CompactionConfig {
  enabled: boolean;
  threshold: number;
  windowSize: number;
  /** loop 内压缩时保留的近期消息数（含成对的 action/observation）。 */
  keepRecent: number;
}

export const COMPACTION_DEFAULTS: CompactionConfig = {
  enabled: true,
  threshold: 0.8,
  windowSize: 10,
  keepRecent: 4,
};

export function readCompactionConfig(
  runtimeConfig: Record<string, unknown> | undefined,
): CompactionConfig {
  if (!runtimeConfig) return { ...COMPACTION_DEFAULTS };
  const raw = (
    runtimeConfig as { memory?: { compaction?: Partial<CompactionConfig> } }
  ).memory?.compaction;
  return { ...COMPACTION_DEFAULTS, ...(raw ?? {}) };
}
