import type { StreamFrame } from '@/shared/types/events';
import type { EnrichedEvent } from '@/shared/types/events';
import type { Message } from '@/shared/types/entities';
import type { ConversationConfig } from '@/server/libs/config';

export type ConvPhase = 'activated' | 'turn-start' | 'turn-end';

// turn-end per-call run 语境（不入 ctx，多 run 并发会互相覆盖），作第三参透传。
export interface RunCtx {
  messageId: string;
  runId: string;
}

// 会话运行时上下文——ConversationSession 即 ctx（无 wrapper）。仅经此窄接口暴露会话状态，process-summary 折叠用。
export interface ConversationContext {
  readonly conversationId: string;
  messages: Message[];
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
