import type { ConvTransform } from '@/server/modules/conversation/domain/model/conv-transform';
import { ConvTransformPlan } from '@/server/modules/conversation/domain/model/conv-transform';
import { ProcessSummaryTransform } from './process-summary-transform';
import { ReconstructTransform } from './reconstruct-transform';
import { SummarizeTransform } from './summarize-transform';
import { UsageTransform } from './usage-transform';

// transform 显式清单（序即同相位运行序）。
// turn-end：烘 summary → 截胖用户消息 → 折叠为 C → 量用量。
export const TRANSFORM_TYPES: (new (...args: any[]) => ConvTransform)[] = [
  ProcessSummaryTransform,
  ReconstructTransform,
  SummarizeTransform,
  UsageTransform,
];

/** ConversationModule 内装配为 provider：注入实例数组构建相位管道。 */
export const CONV_TRANSFORM_PLAN = Symbol('CONV_TRANSFORM_PLAN');
export type ConvTransformPlanToken = ConvTransformPlan;
