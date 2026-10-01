import type { Hook } from '@/server/modules/agent/domain/model/hook';
import { ToolHintHook } from './tool-hint-hook';
import { TrimHook } from './trim-hook';
import { MicroCompactHook } from './micro-compact-hook';
import { QueryBudgetHook } from './query-budget-hook';
import { CompactionHook } from './compaction-hook';
import { LoopUsageHook } from './loop-usage-hook';
import { CumulativeBudgetHook } from './cumulative-budget-hook';
import { StuckHook } from './stuck-hook';
import { MaxIterationsHook } from './max-iterations-hook';

// per-run 瞬态 hook 清单（序即相位内执行序）。注册为 TRANSIENT providers，
// executor 经 ModuleRef 按次 get——每次新建实例，跨 tick 私有状态内聚实例字段。
export const HOOK_TYPES: (new (...args: any[]) => Hook)[] = [
  ToolHintHook,
  TrimHook,
  MicroCompactHook,
  QueryBudgetHook,
  CompactionHook,
  LoopUsageHook,
  CumulativeBudgetHook,
  StuckHook,
  MaxIterationsHook,
];
