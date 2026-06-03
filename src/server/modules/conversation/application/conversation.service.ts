import type { Message, MessageAttachment } from '@/shared/types/entities';
import { Role } from '@/shared/entities/Message';
import { generateId } from '@/shared/utils';
import { inject, singleton } from 'tsyringe';
import { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';
import { MESSAGE_REPOSITORY } from '../conversation.di-tokens';
import type { MessageRepositoryPort } from '../database/message.repository.port';

@singleton()
export class ConversationService {
  constructor(
    @inject(MESSAGE_REPOSITORY)
    private messageRepo: MessageRepositoryPort,
    @inject(WorkspaceService)
    private workspaceService: WorkspaceService,
  ) {}

  async activate(params: {
    conversationId: string;
    userId: string;
    systemPrompt: string;
    context?: string;
  }): Promise<void> {
    const existing = await this.messageRepo.findByConversationId(
      params.conversationId,
    );
    if (existing.length > 0) return;

    const workDir = await this.workspaceService.getWorkDir(
      params.conversationId,
    );
    const messages = this.buildSystemMessages({ ...params, workDir });
    for (const msg of messages) msg.conversationId = params.conversationId;
    await this.messageRepo.batchCreate(params.conversationId, messages);
  }

  async appendMessage(params: {
    conversationId: string;
    userMessage: {
      role: Role;
      content: string;
      attachments?: MessageAttachment[] | null;
      meta?: Record<string, any> | null;
    };
    assistantId?: string;
  }): Promise<{
    existingMessages: Message[];
    assistantId: string;
    assistantMessage: Message;
  }> {
    const existingMessages = await this.messageRepo.findByConversationId(
      params.conversationId,
    );

    const assistantId = params.assistantId ?? generateId('msg');
    const now = Date.now();
    const newMessages: Message[] = [
      {
        id: generateId('msg'),
        role: params.userMessage.role,
        content: params.userMessage.content,
        attachments: params.userMessage.attachments ?? null,
        meta: params.userMessage.meta ?? null,
        createdAt: new Date(now),
        conversationId: params.conversationId,
      },
      {
        id: assistantId,
        role: Role.ASSIST,
        content: '',
        attachments: null,
        status: 'initialized',
        meta: null,
        createdAt: new Date(now + 1),
        conversationId: params.conversationId,
      },
    ];
    await this.messageRepo.batchCreate(params.conversationId, newMessages);

    return {
      existingMessages,
      assistantId,
      assistantMessage: newMessages[1],
    };
  }

  private buildSystemMessages(params: {
    userId: string;
    workDir: string;
    systemPrompt: string;
    context?: string;
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
      conversationId: '',
    });

    const sessionContext = `<session-context>
User ID: ${params.userId}
Workspace Directory: ${params.workDir}
</session-context>`;

    messages.push({
      id: generateId('msg'),
      role: Role.USER,
      content: sessionContext,
      attachments: null,
      meta: { hidden: true },
      createdAt: new Date(baseTime + index++),
      conversationId: '',
    });

    if (params.context) {
      messages.push({
        id: generateId('msg'),
        role: Role.USER,
        content: params.context,
        attachments: null,
        meta: { hidden: true },
        createdAt: new Date(baseTime + index++),
        conversationId: '',
      });
    }

    return messages;
  }
}
