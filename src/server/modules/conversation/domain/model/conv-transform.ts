import type { StreamFrame } from '@/shared/types/events';
import type { Message } from '@/shared/types/entities';
import { ListMonad } from '@/server/libs/list';

export type ConvPhase = 'activated' | 'turn-start' | 'turn-end';

/**
 * 会话运行时上下文——ConversationSession 满足此接口（session 即 ctx，无 wrapper 对象）。
 * 转换（transform）只经此窄接口访问会话状态，够不到 activeRuns/connection/dispose。
 * messages 可变（转换替换整个值=改）；runtimeConfig/transforms 为激活时灌入的只读快照。
 * contextSize 不在此——按需 providerService.resolveChatModel(runtimeConfig.model) 派生。
 */
export interface ConversationContext {
  readonly conversationId: string;
  messages: ListMonad<Message>;
  readonly runtimeConfig: Record<string, unknown>;
  readonly transforms: ConvTransformPlan;
}

export interface ConvTransform {
  readonly id: string;
  /** 一个 transform 可注册在多个相位（如 summary-bake @ turn-start + turn-end）。 */
  readonly phase: ConvPhase | ConvPhase[];
  apply: (ctx: ConversationContext) => AsyncGenerator<StreamFrame | void>;
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
