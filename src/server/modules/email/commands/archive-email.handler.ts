import { AgentIds } from '@/shared/constants';
import { generateId } from '@/shared/utils';
import type { AgentBinding } from '@/shared/types/agent';
import type { Message } from '@/shared/types/entities';
import { Role } from '@/shared/entities/Message';
import { container, inject } from 'tsyringe';
import type { Agent } from '@/server/modules/agent/domain/agent.base';
import { TraceContext } from '@/server/core/TraceContext';
import { service } from '@/server/decorator/service';
import {
  CacheService,
  type CachedReference,
} from '@/server/modules/memory/adapters/cache.adapter';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import { SessionManager } from '@/server/modules/conversation/session-manager';
import { CONVERSATION_REPOSITORY } from '@/server/modules/conversation/conversation.di-tokens';
import type { ConversationRepositoryPort } from '@/server/modules/conversation/database/conversation.repository.port';
import { StartChatTurnCommand } from '@/server/modules/conversation/commands/start-chat-turn.command';
import { StartChatTurnHandler } from '@/server/modules/conversation/commands/start-chat-turn.handler';
import { RunAgentSessionCommand } from '@/server/modules/conversation/commands/run-agent-session.command';
import { RunAgentSessionHandler } from '@/server/modules/conversation/commands/run-agent-session.handler';
import { EmailService } from '../email.service';
import type { EmailEntity } from '@/shared/entities/Email';
import {
  ArchiveEmailCommand,
  type ArchiveEmailResult,
} from './archive-email.command';

@service()
export class ArchiveEmailHandler {
  constructor(
    @inject(EmailService)
    private readonly emailService: EmailService,
    @inject(CONVERSATION_REPOSITORY)
    private readonly convRepo: ConversationRepositoryPort,
    @inject(SessionManager)
    private readonly sessionManager: SessionManager,
    @inject(StartChatTurnHandler)
    private readonly startChatTurnHandler: StartChatTurnHandler,
    @inject(RunAgentSessionHandler)
    private readonly runAgentSessionHandler: RunAgentSessionHandler,
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

    const agent = container.resolve<Agent>(AgentIds.REACT);

    await this.startArchiveSession(conversation, email, agent);

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
    agent: Agent,
  ): Promise<void> {
    const conversationId = conversation.id;

    TraceContext.update({
      conversationId,
      userId: conversation.userId,
    });

    const session = await this.sessionManager.acquireSession(conversationId);
    if (!session) {
      throw new Error(`Failed to acquire session for ${conversationId}`);
    }

    const assistantId = generateId('msg');

    TraceContext.update({
      messageId: assistantId,
      traceId: assistantId,
    });
    TraceContext.freeze();

    const contentOrCached = await this.cacheService.compress(
      conversationId,
      email.content,
    );
    const userContent = this.buildArchivePrompt(
      email,
      contentOrCached as string | CachedReference,
    );

    const turnCommand = new StartChatTurnCommand(
      conversationId,
      conversation.userId,
      agent.systemPrompt.build(),
      undefined,
      {
        role: Role.USER,
        content: userContent,
        meta: { emailId: email.id },
      },
      assistantId,
    );

    const { messages } = await this.startChatTurnHandler.execute(turnCommand);

    const binding: AgentBinding = {
      agentId: agent.id,
      config: {},
    };

    const assistantMessage: Message = {
      id: assistantId,
      role: Role.ASSIST,
      content: '',
      attachments: null,
      status: 'initialized',
      meta: null,
      createdAt: new Date(),
      conversationId,
    };

    const runCommand = new RunAgentSessionCommand(
      conversationId,
      agent,
      messages,
      assistantMessage,
      binding,
    );

    const run = await this.runAgentSessionHandler.prepare(runCommand);

    this.runAgentSessionHandler.stream(conversationId, run);
  }
}
