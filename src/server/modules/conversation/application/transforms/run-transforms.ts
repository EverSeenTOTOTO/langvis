import type { StreamFrame } from '@/shared/types/events';
import type {
  ConversationContext,
  ConvPhase,
  RunCtx,
} from '@/server/modules/conversation/domain/model/conv-transform';

// 按相位跑 transform（注册序，无 priority）；抛错冒泡给调用方兜底。runCtx 仅 turn-end 透传。
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
