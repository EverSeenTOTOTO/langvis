import type { StreamFrame } from '@/shared/types/events';
import {
  ConvTransformPlan,
  type ConversationContext,
  type ConvPhase,
  type RunCtx,
} from '@/server/modules/conversation/domain/model/conv-transform';
import { resolveConvTransforms } from './registry';

/** 全局 transform 管道（单例缓存——transform 跨会话不变，无需每会话解析）。 */
let cachedPlan: ConvTransformPlan | undefined;
export function getConvTransformPlan(): ConvTransformPlan {
  return (cachedPlan ??= new ConvTransformPlan(resolveConvTransforms()));
}

/**
 * 按相位跑 transform（注册序，无 priority）。镜像 agent 的 applyHooks：
 * 逐个 yield* transform.apply(ctx, runCtx)；无 try/catch——抛错冒泡给调用方（编排器）兜底。
 * runCtx 仅 turn-end 由调用方透传（per-run 语境）；activated/turn-start 不传。
 */
export async function* runConvTransforms(
  ctx: ConversationContext,
  phase: ConvPhase,
  runCtx?: RunCtx,
): AsyncGenerator<StreamFrame | void, void, void> {
  const transforms = ctx.transforms.forPhase(phase);
  for (const transform of transforms) {
    yield* transform.apply(ctx, runCtx);
  }
}
