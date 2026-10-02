import type { Hook } from '@/server/modules/agent/domain/model/hook';
import { ToolHintHook } from './tool-hint-hook';
import { LoopUsageHook } from './loop-usage-hook';
import { CumulativeBudgetHook } from './cumulative-budget-hook';
import { StuckHook } from './stuck-hook';
import { MaxIterationsHook } from './max-iterations-hook';

// LoopGuard + run 增强（序即相位内执行序）。上下文管理类已迁 stages/（STAGE_TYPES）。
// 注册为 TRANSIENT providers，executor 经 ModuleRef 按次 get——每次新建实例，跨 tick 私有状态内聚实例字段。
export const HOOK_TYPES: (new (...args: any[]) => Hook)[] = [
  ToolHintHook,
  LoopUsageHook,
  CumulativeBudgetHook,
  StuckHook,
  MaxIterationsHook,
];
