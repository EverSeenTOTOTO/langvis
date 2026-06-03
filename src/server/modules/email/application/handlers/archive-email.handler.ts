import { AgentIds } from '@/shared/constants';
import { Role } from '@/shared/entities/Message';
import { inject } from 'tsyringe';
import { service } from '@/server/decorator/service';
import {
  CacheService,
  type CachedReference,
} from '@/server/modules/memory/services/cache.service';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import { SessionManager } from '@/server/modules/conversation/session-manager';
import { CONVERSATION_REPOSITORY } from '@/server/modules/conversation/conversation.di-tokens';
import type { ConversationRepositoryPort } from '@/server/modules/conversation/database/conversation.repository.port';
import { ConversationActivateCommand } from '@/server/modules/conversation/commands/conversation-activate.command';
import { ConversationActivateHandler } from '@/server/modules/conversation/application/handlers/conversation-activate.handler';
import { StartChatCommand } from '@/server/modules/conversation/commands/start-chat.command';
import { StartChatHandler } from '@/server/modules/conversation/application/handlers/start-chat.handler';
import { EmailService } from '../../domain/email.service';
import type { EmailEntity } from '@/shared/entities/Email';
import {
  ArchiveEmailCommand,
  type ArchiveEmailResult,
} from '../../commands/archive-email.command';

@service()
export class ArchiveEmailHandler {
  constructor(
    @inject(EmailService)
    private readonly emailService: EmailService,
    @inject(CONVERSATION_REPOSITORY)
    private readonly convRepo: ConversationRepositoryPort,
    @inject(SessionManager)
    private readonly sessionManager: SessionManager,
    @inject(ConversationActivateHandler)
    private readonly activateHandler: ConversationActivateHandler,
    @inject(StartChatHandler)
    private readonly startChatHandler: StartChatHandler,
    @inject(ProviderService)
    private readonly providerService: ProviderService,
    @inject(CacheService)
    private readonly cacheService: CacheService,
  ) {}

  async execute(command: ArchiveEmailCommand): Promise<ArchiveEmailResult> {
    const { emailId, userId } = command;

    const email = await this.emailService.getById(emailId);
    if (!email) {
      throw new Error(`Email not found: ${emailId}`);
    }

    await this.emailService.updateStatus(emailId, 'archived');

    const defaultModel = this.providerService.getDefaultModel('chat');
    const conversation = await this.convRepo.create(
      `归档邮件: ${email.subject}`,
      userId,
      {
        agent: AgentIds.REACT,
        model: { modelId: defaultModel?.id },
        memory: {
          type: 'react_memory',
          windowSize: 10,
        },
      },
      null,
      'Email Archive',
    );

    if (userId !== conversation.userId) {
      throw new Error(`Mismatched conversation user: ${userId}`);
    }

    await this.startArchiveSession(conversation, email);

    return { conversationId: conversation.id };
  }

  private buildArchivePrompt(
    email: EmailEntity,
    contentOrCached: string | CachedReference,
  ): string {
    const fromDisplay = email.fromName
      ? `${email.fromName} <${email.from}>`
      : email.from;

    if (typeof contentOrCached === 'string') {
      return `使用 document_archive 技能归档邮件：${email.subject}\n\n发件人：${fromDisplay}\n发件时间：${email.sentAt.toISOString()}\n\n内容：\n${contentOrCached}`;
    }

    return `使用 document_archive 技能归档邮件：${email.subject}\n\n发件人：${fromDisplay}\n发件时间：${email.sentAt.toISOString()}\n\n内容已缓存：${JSON.stringify(contentOrCached)}`;
  }

  private async startArchiveSession(
    conversation: { id: string; userId: string },
    email: EmailEntity,
  ): Promise<void> {
    const conversationId = conversation.id;

    const session = await this.sessionManager.acquireSession(conversationId);
    if (!session) {
      throw new Error(`Failed to acquire session for ${conversationId}`);
    }

    const contentOrCached = await this.cacheService.compress(
      conversationId,
      email.content,
    );
    const userContent = this.buildArchivePrompt(
      email,
      contentOrCached as string | CachedReference,
    );

    // 1. 激活（入库系统消息+上下文消息）
    await this.activateHandler.execute(
      new ConversationActivateCommand(conversationId, conversation.userId),
    );

    // 2. 发送消息（追加用户消息 + 触发 AgentRunHandler）
    await this.startChatHandler.execute(
      new StartChatCommand(conversationId, {
        role: Role.USER,
        content: userContent,
        meta: { emailId: email.id },
      }),
    );
  }
}
