import type { Message, MessageAttachment } from '@/shared/types/entities';
import { Role } from '@/shared/types/entities';
import { generateId } from '@/shared/utils';

export function createActivationMessages(params: {
  conversationId: string;
  userId: string;
  workDir: string;
  systemPrompt: string;
  /** 环境快照（日期/平台/git 概要/目录树）；缺省回退仅 workDir。 */
  environment?: string;
}): Message[] {
  const baseTime = Date.now();
  let index = 0;
  const messages: Message[] = [];

  messages.push({
    id: generateId('msg'),
    role: Role.SYSTEM,
    content: params.systemPrompt,
    attachments: null,
    meta: null,
    createdAt: new Date(baseTime + index++),
    conversationId: params.conversationId,
  });

  const contextBody =
    params.environment ?? `Workspace Directory: ${params.workDir}`;
  messages.push({
    id: generateId('msg'),
    role: Role.USER,
    content: `<session-context>\nUser ID: ${params.userId}\n${contextBody}\n</session-context>`,
    attachments: null,
    meta: { kind: 'context' },
    createdAt: new Date(baseTime + index++),
    conversationId: params.conversationId,
  });

  return messages;
}

export function createTurnMessages(params: {
  conversationId: string;
  userMessage: {
    role: Role;
    content: string;
    attachments?: MessageAttachment[] | null;
    meta?: Record<string, unknown> | null;
  };
  assistantId?: string;
}): { userMessage: Message; assistantMessage: Message } {
  const assistantId = params.assistantId ?? generateId('msg');
  const now = Date.now();

  const userMessage: Message = {
    id: generateId('msg'),
    role: params.userMessage.role,
    content: params.userMessage.content,
    attachments: params.userMessage.attachments ?? null,
    meta: params.userMessage.meta ?? null,
    createdAt: new Date(now),
    conversationId: params.conversationId,
  };

  const assistantMessage: Message = {
    id: assistantId,
    role: Role.ASSIST,
    content: '',
    attachments: null,
    meta: null,
    createdAt: new Date(now + 1),
    conversationId: params.conversationId,
  };

  return { userMessage, assistantMessage };
}
