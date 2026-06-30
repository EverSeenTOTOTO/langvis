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

import type { LlmMessage, Message } from '@/shared/types/entities';
import type { EnrichedEvent } from '@/shared/types/events';

export const TurnInitiated = 'turn_initiated';
/** agent→conv：run 开始（conv 据此 registerRun + persistAgentRunId）。 */
export const RunStarted = 'run_started';
/** agent→conv：run 的每条富化事件（conv 据此 SSE 桥接 + 缓冲）。 */
export const RunEvent = 'run_event';
/** conv→agent：请求取消某 run（agent 据此 executor.cancel，取消事件经 RunEvent 回流）。 */
export const CancelRun = 'cancel_run';
export const RunCompleted = 'run_completed';

export interface TurnInitiatedPayload {
  conversationId: string;
  assistantMessage: Message;
  userConfig: Record<string, unknown>;
  systemPrompt: string;
  /** 会话有效历史（LLM-ready，conv 的 ConversationMemory 产物）—— agent 直接作种子，不再回调 conv。 */
  effectiveHistory: LlmMessage[];
}

export interface RunStartedPayload {
  conversationId: string;
  messageId: string;
  runId: string;
}

export interface RunEventPayload {
  conversationId: string;
  messageId: string;
  event: EnrichedEvent;
}

export interface CancelRunPayload {
  runId: string;
  conversationId: string;
  messageId: string;
  reason: string;
}

export interface RunCompletedPayload {
  conversationId: string;
  messageId: string;
  agentRunId: string;
}

/** 既有会话行可能仍存有收敛后废弃的键（`agent`、`memory`），此处静默丢弃。 */
export function extractUserConfig(conv: {
  config?: Record<string, any> | null;
}): Record<string, unknown> {
  const { agent: _agent, memory: _memory, ...rest } = conv.config ?? {};
  return rest;
}
