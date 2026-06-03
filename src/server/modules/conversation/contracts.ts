import type { AgentBinding } from '@/shared/types/agent';
import type { MessageAttachment } from '@/shared/types/entities';
import { Role } from '@/shared/entities/Message';
import { Command, Query } from '@/server/libs/ddd';

// ── Commands ──────────────────────────────────────────────

export class ConversationActivateCommand extends Command {
  constructor(
    readonly conversationId: string,
    readonly userId: string,
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

// ── Queries ───────────────────────────────────────────────

export class GetSessionStateQuery extends Query {
  constructor(readonly conversationId: string) {
    super();
  }
}

// ── Events ────────────────────────────────────────────────

import type { Message } from '@/shared/types/entities';

export const ConversationActivated = 'conversation_activated';
export const ChatStarted = 'chat_started';

export interface ConversationActivatedPayload {
  conversationId: string;
  agentBinding: AgentBinding;
}

export interface ChatStartedPayload {
  conversationId: string;
  assistantMessage: Message;
  agentBinding: AgentBinding;
  systemPrompt: string;
}

// ── Utils ─────────────────────────────────────────────────

export function extractBinding(conv: {
  config?: Record<string, any> | null;
}): AgentBinding {
  const config = conv.config ?? {};
  const { agent: agentId, ...restConfig } = config as any;
  return { agentId: agentId ?? 'chat_agent', config: restConfig };
}
