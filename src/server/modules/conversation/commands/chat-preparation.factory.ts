import type { Message, MessageAttachment } from '@/shared/types/entities';
import { Role } from '@/shared/entities/Message';
import { generateId } from '@/shared/utils';

export interface PrepareTurnParams {
  isFirstTurn: boolean;
  systemPrompt: string;
  userId: string;
  workDir: string;
  context?: string;
  userMessage: {
    role: Role;
    content: string;
    attachments?: MessageAttachment[] | null;
    meta?: Record<string, any> | null;
  };
  assistantId?: string;
}

export interface PrepareTurnResult {
  newMessages: Message[];
  assistantId: string;
  assistantMessage: Message;
}

/**
 * ChatPreparationFactory — pure domain rules for constructing a chat turn.
 *
 * Encapsulates the business logic of:
 * - First-turn: inject system prompt + session context + optional context
 * - Every turn: append user message + assistant placeholder
 */
export function prepareTurn(params: PrepareTurnParams): PrepareTurnResult {
  const {
    isFirstTurn,
    systemPrompt,
    userId,
    workDir,
    context,
    userMessage,
    assistantId: preGeneratedAssistantId,
  } = params;

  const baseTime = Date.now();
  let index = 0;
  const newMessages: Message[] = [];

  if (isFirstTurn) {
    newMessages.push({
      id: generateId('msg'),
      role: Role.SYSTEM,
      content: systemPrompt,
      attachments: null,
      meta: null,
      createdAt: new Date(baseTime + index++),
      conversationId: '',
    });

    const sessionContext = `<session-context>
User ID: ${userId}
Workspace Directory: ${workDir}
</session-context>`;

    newMessages.push({
      id: generateId('msg'),
      role: Role.USER,
      content: sessionContext,
      attachments: null,
      meta: { hidden: true },
      createdAt: new Date(baseTime + index++),
      conversationId: '',
    });

    if (context) {
      newMessages.push({
        id: generateId('msg'),
        role: Role.USER,
        content: context,
        attachments: null,
        meta: { hidden: true },
        createdAt: new Date(baseTime + index++),
        conversationId: '',
      });
    }
  }

  newMessages.push({
    id: generateId('msg'),
    ...userMessage,
    createdAt: new Date(baseTime + index++),
    conversationId: '',
  });

  const assistantId = preGeneratedAssistantId ?? generateId('msg');
  const assistantMessage: Message = {
    id: assistantId,
    role: Role.ASSIST,
    content: '',
    attachments: null,
    status: 'initialized',
    meta: null,
    createdAt: new Date(baseTime + index++),
    conversationId: '',
  };
  newMessages.push(assistantMessage);

  return { newMessages, assistantId, assistantMessage };
}
