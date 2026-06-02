import { Role } from '@/shared/entities/Message';
import type { Message, MessageAttachment } from '@/shared/types/entities';
import { generateId } from '@/shared/utils';
import { inject } from 'tsyringe';
import { service } from '@/server/decorator/service';
import Logger from '@/server/utils/logger';
import { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';
import { MESSAGE_REPOSITORY } from '../conversation.di-tokens';
import type { MessageRepositoryPort } from '../database/message.repository.port';

export interface PrepareTurnResult {
  messages: Message[];
  assistantId: string;
  assistantMessage: Message;
}

@service()
export class StartChatTurn {
  private readonly logger = Logger.child({ source: 'StartChatTurn' });

  constructor(
    @inject(MESSAGE_REPOSITORY)
    private messageRepo: MessageRepositoryPort,
    @inject(WorkspaceService)
    private workspaceService: WorkspaceService,
  ) {}

  async execute(params: {
    conversationId: string;
    userId: string;
    systemPrompt: string;
    context?: string;
    userMessage: {
      role: Role;
      content: string;
      attachments?: MessageAttachment[] | null;
      meta?: Record<string, any> | null;
    };
    assistantId?: string;
  }): Promise<PrepareTurnResult> {
    const {
      conversationId,
      userId,
      systemPrompt,
      context,
      userMessage,
      assistantId: preGeneratedAssistantId,
    } = params;

    const existingMessages =
      await this.messageRepo.findByConversationId(conversationId);
    const isFirstTurn = existingMessages.length === 0;

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
        conversationId,
      });

      const workDir = await this.workspaceService.getWorkDir(conversationId);
      const sessionContext = `<session-context>
Conversation ID: ${conversationId}
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
        conversationId,
      });

      if (context) {
        newMessages.push({
          id: generateId('msg'),
          role: Role.USER,
          content: context,
          attachments: null,
          meta: { hidden: true },
          createdAt: new Date(baseTime + index++),
          conversationId,
        });
      }
    }

    newMessages.push({
      id: generateId('msg'),
      ...userMessage,
      createdAt: new Date(baseTime + index++),
      conversationId,
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
      conversationId,
    };
    newMessages.push(assistantMessage);

    this.messageRepo.batchCreate(conversationId, newMessages).catch(err => {
      this.logger.error('Failed to persist turn messages', err);
    });

    return {
      messages: [...existingMessages, ...newMessages.slice(0, -1)],
      assistantId,
      assistantMessage,
    };
  }
}
