import type { AgentBinding } from '@/shared/types/agent';
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
