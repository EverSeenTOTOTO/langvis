import type { RunStatus } from './agent';
import type { ReActStep } from './render';
import type { EnrichedEvent } from './events';
import type { RuntimeConfigVOProps } from '@/server/modules/agent/domain/model/runtime-config.vo';

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
  parentId?: string | null;
  agentRunId?: string | null;
  /** Merged from agent_runs for assistant messages — not a Message DB column */
  steps?: ReActStep[] | null;
  /** Merged from agent_runs for assistant messages — not a Message DB column */
  status?: RunStatus | null;
  meta?: Record<string, unknown> | null;
  createdAt: Date;
  conversationId: string;
  loading?: boolean;
};

export type AgentRun = {
  id: string;
  status: RunStatus;
  /** 事实源 —— content/steps 由 projectRun 派生 */
  events: EnrichedEvent[] | null;
  config: RuntimeConfigVOProps | null;
  startedAt: Date;
  completedAt: Date | null;
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
