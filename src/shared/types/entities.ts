import { AgentEvent } from '.';

export enum Role {
  SYSTEM = 'system',
  USER = 'user',
  ASSIST = 'assistant',
}

export type Message = {
  id: string;
  role: Role;
  content: string;
  meta?: { events?: AgentEvent[] } | null;
  createdAt: Date;
  conversationId: string;
  loading?: boolean;
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
