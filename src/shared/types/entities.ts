import { AgentEvent } from '.';

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
  meta?:
    | (Record<string, unknown> & {
        events?: AgentEvent[];
        hidden?: boolean;
      })
    | null;
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
