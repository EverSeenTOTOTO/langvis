import type { StreamFrame } from '@/shared/types/events';
import type {
  ConversationContext,
  ConvPhase,
} from '@/server/modules/conversation/domain/model/conv-transform';

/**
 * 按相位跑 transform（注册序，无 priority）。镜像 agent 的 applyHooks：
 * 逐个 yield* transform.apply(ctx)；无 try/catch——抛错冒泡给调用方（编排器）兜底。
 */
export async function* runConvTransforms(
  ctx: ConversationContext,
  phase: ConvPhase,
): AsyncGenerator<StreamFrame | void, void, void> {
  const transforms = ctx.transforms.forPhase(phase);
  for (const transform of transforms) {
    yield* transform.apply(ctx);
  }
}
