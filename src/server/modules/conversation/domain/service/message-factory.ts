import type { Message, MessageAttachment } from '@/shared/types/entities';
import { Role } from '@/shared/types/entities';
import { generateId } from '@/shared/utils';

/**
 * MessageFactory — 纯消息构建（无 repo 依赖）。
 *
 * 从 Chat 聚合根抽取的消息生命周期逻辑。聚合根删除后由 ChatService 调用。
 */

export function createActivationMessages(params: {
  conversationId: string;
  userId: string;
  workDir: string;
  systemPrompt: string;
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

  messages.push({
    id: generateId('msg'),
    role: Role.USER,
    content: `<session-context>\nUser ID: ${params.userId}\nWorkspace Directory: ${params.workDir}\n</session-context>`,
    attachments: null,
    meta: { hidden: true },
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
