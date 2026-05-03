import { AgentEvent, MessagePhase } from '.';

export enum Role {
  SYSTEM = 'system',
  USER = 'user',
  ASSIST = 'assistant',
}

export interface MessageAttachment {
  filename: string;
  url: string;
  mimeType: string;
  size?: number;
}

export type Message = {
  id: string;
  role: Role;
  content: string;
  attachments?: MessageAttachment[] | null;
  events?: AgentEvent[] | null;
  status?: MessagePhase | null;
  meta?: Record<string, unknown> | null;
  createdAt: Date;
  conversationId: string;
  loading?: boolean;
};

export type LlmMessage = {
  role: Role | 'system' | 'user' | 'assistant';
  content: string;
  attachments?: MessageAttachment[] | null;
};

export type Conversation = {
  id: string;
  name: string;
  config: Record<string, any> | null;
  groupId: string;
  order: number;
  userId: string;
  createdAt: Date;
  messages?: Message[];
  group?: ConversationGroup;
};

export type ConversationGroup = {
  id: string;
  name: string;
  order: number;
  userId: string;
  createdAt: Date;
  conversations?: Conversation[];
};

export type User = {
  id: string;
  name: string;
  email: string;
  emailVerified: boolean;
  image?: string | null;
  createdAt: Date;
  updatedAt: Date;
};
