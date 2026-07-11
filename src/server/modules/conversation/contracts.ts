import type { MessageAttachment } from '@/shared/types/entities';
import { Role } from '@/shared/entities/Message';
import { Command, Query } from '@/server/libs/ddd';

export class ConversationActivateCommand extends Command {
  constructor(
    readonly conversationId: string,
    readonly userId: string,
  ) {
    super();
  }
}

export class CreateConversationCommand extends Command {
  constructor(
    readonly name: string,
    readonly userId: string,
    readonly config?: Record<string, any> | null,
    readonly groupId?: string | null,
    readonly groupName?: string,
  ) {
    super();
  }
}

export class CancelChatCommand extends Command {
  constructor(
    readonly conversationId: string,
    readonly messageId?: string,
    readonly reason: string = 'Cancelled by user',
  ) {
    super();
  }
}

export class ConversationUpdateCommand extends Command {
  constructor(
    readonly conversationId: string,
    readonly userId: string,
    readonly name: string,
    readonly config?: Record<string, any> | null,
    readonly groupId?: string | null,
    readonly groupName?: string | null,
  ) {
    super();
  }
}

export class StartChatCommand extends Command {
  constructor(
    readonly conversationId: string,
    readonly userMessage: {
      role: Role;
      content: string;
      attachments?: MessageAttachment[] | null;
      meta?: Record<string, any> | null;
    },
    readonly userId: string,
    readonly assistantId?: string,
  ) {
    super();
  }
}

export class GetSessionStateQuery extends Query {
  constructor(readonly conversationId: string) {
    super();
  }
}

export class GetMessagesQuery extends Query {
  constructor(readonly conversationId: string) {
    super();
  }
}

/** 取任意 run（含子 agent run）的投影视图——live（父 session 缓冲）优先、repo 回落。 */
export class GetRunViewQuery extends Query {
  constructor(readonly runId: string) {
    super();
  }
}

import type { LlmMessage, Message } from '@/shared/types/entities';

/**
 * 会话解析后的配置（跨 BC 契约）：contextSize（模型派生）+ runtimeConfig（composeConfigSchema 解析的全量配置）。
 * 由 conv 侧 resolveConversationConfig 一次性解析、存于 ConversationSession，经 TurnInitiated 传 agent 复用——
 * 避免两边各 parse/resolveChatModel 一遍（同 schema、同 provider，纯冗余）。
 */
export interface ConversationConfig {
  contextSize: number;
  runtimeConfig: Record<string, unknown>;
}

export const TurnInitiated = 'turn_initiated';

export interface TurnInitiatedPayload {
  conversationId: string;
  assistantMessage: Message;
  /** 会话解析后的配置（conv 侧一次性解析，agent 直接复用——不再二次 parse/resolveChatModel）。 */
  config: ConversationConfig;
  systemPrompt: string;
  /** 会话有效历史（LLM-ready，conv turn-start transform/projection 产物）—— agent 直接作种子，不再回调 conv。 */
  effectiveHistory: LlmMessage[];
}

// Run* 领域事件契约（RunStarted / RunEvent / CancelRun / RunCompleted）归 agent 模块所有，
// 见 @/server/modules/agent/contracts.ts——agent 拥有并外发，conv 按需 import。
