import type { StreamFrame } from '@/shared/types/events';
import type { EnrichedEvent } from '@/shared/types/events';
import type { Message } from '@/shared/types/entities';
import type { ConversationConfig } from '@/server/libs/config';
import { ListMonad } from '@/server/libs/list';

export type ConvPhase = 'activated' | 'turn-start' | 'turn-end';

/** turn-end per-call run 语境：本次 RunCompleted 的 run/message 标识。
 *  不入 ctx（ctx 是 conversation 级，多 run 并发会互相覆盖）——作 runConvTransforms 第三参透传。 */
export interface RunCtx {
  messageId: string;
  runId: string;
}

/**
 * 会话运行时上下文——ConversationSession 满足此接口（session 即 ctx，无 wrapper 对象）。
 * 转换（transform）只经此窄接口访问会话状态，够不到 connection/dispose/flush 等 run 机器零件。
 * messages 可变（转换替换整个值=改）；runtimeConfig/transforms 为激活时灌入的只读快照。
 * getRunEvents 只读暴露活跃 run 事件流（process-summary 折叠用），不暴露 run 内部状态。
 * contextSize 不在此——按需 providerService.resolveChatModel(runtimeConfig.model) 派生。
 */
export interface ConversationContext {
  readonly conversationId: string;
  messages: ListMonad<Message>;
  readonly runtimeConfig: ConversationConfig;
  readonly transforms: ConvTransformPlan;
  getRunEvents(messageId: string): readonly EnrichedEvent[] | undefined;
}

export interface ConvTransform {
  readonly id: string;
  /** 一个 transform 可注册在多个相位（如 usage @ activated + turn-end）。 */
  readonly phase: ConvPhase | ConvPhase[];
  /** turn-end 透传 per-call run 语境（activated/turn-start 为 undefined）。 */
  apply: (
    ctx: ConversationContext,
    runCtx?: RunCtx,
  ) => AsyncGenerator<StreamFrame | void>;
}

export class ConvTransformPlan {
  private readonly byPhase: Readonly<
    Record<ConvPhase, readonly ConvTransform[]>
  >;

  constructor(transforms: readonly ConvTransform[] = []) {
    const inPhase = (t: ConvTransform, p: ConvPhase) =>
      Array.isArray(t.phase) ? t.phase.includes(p) : t.phase === p;
    this.byPhase = {
      activated: transforms.filter(t => inPhase(t, 'activated')),
      'turn-start': transforms.filter(t => inPhase(t, 'turn-start')),
      'turn-end': transforms.filter(t => inPhase(t, 'turn-end')),
    };
  }

  forPhase(phase: ConvPhase): readonly ConvTransform[] {
    return this.byPhase[phase];
  }
}
