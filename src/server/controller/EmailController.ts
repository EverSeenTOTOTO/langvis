import { AgentIds, MemoryIds } from '@/shared/constants';
import { ListEmailsRequestDto } from '@/shared/dto/controller';
import { generateId } from '@/shared/utils';
import { Conversation } from '@/shared/entities/Conversation';
import { EmailEntity } from '@/shared/entities/Email';
import { Role } from '@/shared/entities/Message';
import type { Request, Response } from 'express';
import { container, inject } from 'tsyringe';
import type { Agent } from '../core/agent';
import { Memory } from '../core/memory';
import { PendingMessage } from '../core/PendingMessage';
import { TraceContext } from '../core/TraceContext';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { body, param, query, request, response } from '../decorator/param';
import { AuthService } from '../service/AuthService';
import { ChatService } from '../service/ChatService';
import { ConversationService } from '../service/ConversationService';
import { EmailService } from '../service/EmailService';
import { ProviderService } from '../service/ProviderService';
import { CacheService, type CachedReference } from '../service/CacheService';
import Logger from '../utils/logger';

const INBOUND_SECRET = import.meta.env.VITE_INBOUND_SECRET || '';

interface InboundEmailBody {
  raw: string;
}

@controller('/api/emails')
export default class EmailController {
  private readonly logger = Logger.child({ source: 'EmailController' });

  constructor(
    @inject(EmailService)
    private readonly emailService: EmailService,
    @inject(ConversationService)
    private readonly conversationService: ConversationService,
    @inject(ChatService)
    private readonly chatService: ChatService,
    @inject(AuthService)
    private readonly authService: AuthService,
    @inject(ProviderService)
    private readonly providerService: ProviderService,
    @inject(CacheService)
    private readonly cacheService: CacheService,
  ) {}

  @api('/')
  async list(@query() dto: ListEmailsRequestDto, @response() res: Response) {
    const result = await this.emailService.list({
      from: dto.from,
      subject: dto.subject,
      startDate: dto.startDate,
      endDate: dto.endDate,
      status: dto.status,
      page: dto.page,
      pageSize: dto.pageSize,
    });

    return res.json(result);
  }

  @api('/:id')
  async getById(@param('id') id: string, @response() res: Response) {
    const email = await this.emailService.getById(id);

    if (!email) {
      return res.status(404).json({ error: 'Email not found' });
    }

    return res.json(email);
  }

  @api('/:id', { method: 'delete' })
  async delete(@param('id') id: string, @response() res: Response) {
    const result = await this.emailService.delete(id);

    if (!result) {
      return res.status(404).json({ error: 'Email not found' });
    }

    return res.json({ success: true });
  }

  @api('/inbound', { method: 'post' })
  async handleInbound(
    @body() emailBody: InboundEmailBody,
    @request() req: Request,
    @response() res: Response,
  ) {
    const secret = req.headers['x-inbound-secret'];

    if (!INBOUND_SECRET || secret !== INBOUND_SECRET) {
      this.logger.warn('Invalid or missing inbound secret');
      return res.status(401).json({ error: 'Unauthorized' });
    }

    if (!emailBody.raw) {
      this.logger.warn('Missing raw email content');
      return res.status(400).json({ error: 'Missing raw email content' });
    }

    try {
      const result = await this.emailService.processInbound(emailBody.raw);

      if (!result.success) {
        this.logger.error(`Archive failed: ${result.error}`);
        return res.status(500).json({ error: result.error });
      }

      this.logger.info(`Email archived successfully: id=${result.id}`);
      return res.status(200).json({ success: true, id: result.id });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to process inbound email: ${errorMsg}`);
      return res.status(500).json({ error: errorMsg });
    }
  }

  @api('/archive/:id', { method: 'post' })
  async archive(
    @param('id') id: string,
    @request() req: Request,
    @response() res: Response,
  ) {
    const email = await this.emailService.getById(id);

    if (!email) {
      return res.status(404).json({ error: `Email not found: ${id}` });
    }

    await this.emailService.updateStatus(id, 'archived');

    const userId = await this.authService.getUserId(req);
    const defaultModel = this.providerService.getDefaultModel('chat');
    const conversation = await this.conversationService.createConversation(
      `归档邮件: ${email.subject}`,
      userId,
      { agent: AgentIds.REACT, model: { modelId: defaultModel?.id } },
      null,
      'Email Archive',
    );

    if (userId !== conversation.userId) {
      return res.status(401).json({
        error: `Mismatched conversation user: ${userId}`,
      });
    }

    const agent = container.resolve<Agent>(AgentIds.REACT);
    res.status(200).json({ conversationId: conversation.id });

    await this.startArchiveSession(conversation, email, agent);
    return;
  }

  private buildArchivePrompt(
    email: EmailEntity,
    contentOrCached: string | CachedReference,
  ): string {
    const fromDisplay = email.fromName
      ? `${email.fromName} <${email.from}>`
      : email.from;

    if (typeof contentOrCached === 'string') {
      return `使用文档归档技能归档邮件：${email.subject}\n\n发件人：${fromDisplay}\n发件时间：${email.sentAt.toISOString()}\n\n内容：\n${contentOrCached}`;
    }

    return `使用文档归档技能归档邮件：${email.subject}\n\n发件人：${fromDisplay}\n发件时间：${email.sentAt.toISOString()}\n\n内容已缓存：${JSON.stringify(contentOrCached)}`;
  }

  private async startArchiveSession(
    conversation: Conversation,
    email: EmailEntity,
    agent: Agent,
  ): Promise<void> {
    const conversationId = conversation.id;

    // Set TraceContext for this conversation
    TraceContext.update({
      conversationId,
      userId: conversation.userId,
    });

    // Create session BEFORE preparing turn to avoid race with frontend SSE
    const session = await this.chatService.acquireSession(conversationId);
    if (!session) {
      throw new Error(`Failed to acquire session for ${conversationId}`);
    }

    // Create memory for this session
    const memory = container.resolve<Memory>(
      conversation.config?.memory?.type ?? MemoryIds.SLIDE_WINDOW,
    );
    if (conversation.config?.memory?.windowSize) {
      memory.setWindowSize(conversation.config.memory.windowSize);
    }
    session.setMemory(memory);

    // Pre-generate assistantId so we can compress before prepareTurn
    const assistantId = generateId('msg');

    // Update TraceContext with messageId for cache lookup
    TraceContext.update({
      messageId: assistantId,
      traceId: assistantId,
    });
    TraceContext.freeze();

    // Compress email content
    const contentOrCached = await this.cacheService.compress(
      conversationId,
      email.content,
    );
    const userContent = this.buildArchivePrompt(
      email,
      contentOrCached as string | CachedReference,
    );

    // Prepare turn messages with actual content (no placeholder needed)
    const { messages, assistantMessage } = await this.chatService.prepareTurn({
      conversationId,
      userId: conversation.userId,
      systemPrompt: agent.systemPrompt.build(),
      userMessage: {
        role: Role.USER,
        content: userContent,
        meta: { emailId: email.id },
      },
      assistantId,
    });

    // Inject context into memory
    memory.setContext(messages);

    const pendingMessage = new PendingMessage(assistantMessage);
    session.addMessageFSM(assistantId, pendingMessage);

    this.chatService.runSession(
      session,
      agent,
      conversation.config,
      assistantId,
    );
  }
}
