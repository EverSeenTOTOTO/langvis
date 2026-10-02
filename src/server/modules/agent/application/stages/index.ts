import type { ContextStage } from '@/server/shared/context';
import { TrimStage } from './trim-stage';
import { MicroCompactStage } from './micro-compact-stage';
import { WindowCheckStage } from './window-check-stage';
import { RunFoldStage } from './run-fold-stage';

// run 域 context stage 清单（序即相位内执行序 = 确定性分层阶梯）：
// 确定性桩化/丢桩 → 整体 fail-fast → LLM 折叠殿后。
export const STAGE_TYPES: (new (...args: any[]) => ContextStage)[] = [
  TrimStage,
  MicroCompactStage,
  WindowCheckStage,
  RunFoldStage,
];
