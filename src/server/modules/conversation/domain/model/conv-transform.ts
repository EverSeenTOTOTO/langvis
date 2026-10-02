import type { StreamFrame } from '@/shared/types/events';
import type { EnrichedEvent } from '@/shared/types/events';
import type { Message } from '@/shared/types/entities';
import type { ConversationConfig } from '@/server/modules/conversation/domain/config';
import type { StagePlan, RunCtx } from '@/server/shared/context';

// 会话运行时上下文——ConversationSession 即 ctx（无 wrapper）。仅经此窄接口暴露会话状态，bake-summary 折叠用。
export interface ConversationContext {
  readonly conversationId: string;
  messages: Message[];
  readonly runtimeConfig: ConversationConfig;
  readonly stages: StagePlan;
  getRunEvents(messageId: string): readonly EnrichedEvent[] | undefined;
}

export type { RunCtx };
export type { StreamFrame };
