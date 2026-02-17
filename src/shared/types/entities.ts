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
  createdAt: Date;
  messages?: Message[];
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
