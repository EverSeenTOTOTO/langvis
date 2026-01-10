export enum Role {
  SYSTEM = 'system',
  USER = 'user',
  ASSIST = 'assistant',
}

type MessageMeta<T extends Record<string, any>> = {
  loading?: boolean;
  streaming?: boolean;
  error?: boolean;
} & T;

export type Message<T extends Record<string, any> = Record<string, any>> = {
  id: string;
  role: Role;
  content: string;
  meta?: MessageMeta<T> | null;
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
