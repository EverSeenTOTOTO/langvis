import { AgentIds } from '@/shared/constants';
import { ListEmailsRequestDto } from '@/shared/dto/controller';
import { Conversation } from '@/shared/entities/Conversation';
import { EmailEntity } from '@/shared/entities/Email';
import { Role } from '@/shared/entities/Message';
import type { Request, Response } from 'express';
import { container, inject } from 'tsyringe';
import type { Agent } from '../core/agent';
import { PendingMessage } from '../core/PendingMessage';
import { TraceContext } from '../core/TraceContext';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { body, param, query, request, response } from '../decorator/param';
import { AuthService } from '../service/AuthService';
import { ChatService } from '../service/ChatService';
import { ConversationService } from '../service/ConversationService';
import { EmailService } from '../service/EmailService';
import { compress, type CachedReference } from '../utils/cache';
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
      return res.status(404).json({ error: 'Email not found' });
    }

    await this.emailService.updateStatus(id, 'archived');

    const userId = await this.authService.getUserId(req);
    const conversation = await this.conversationService.createConversation(
      `归档邮件: ${email.subject}`,
      userId,
      { agent: AgentIds.DOCUMENT },
      null,
      'Email Archive',
    );

    const agent = container.resolve<Agent>(AgentIds.DOCUMENT);
    const contentOrCached = await compress(conversation.id, email.content);
    const userContent = this.buildArchivePrompt(
      email,
      contentOrCached as string | CachedReference,
    );

    res.status(200).json({ conversationId: conversation.id });

    await this.startArchiveSession(conversation, email, userContent, agent);
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
      return `请归档邮件：${email.subject}\n\n发件人：${fromDisplay}\n发件时间：${email.sentAt.toISOString()}\n\n内容：\n${contentOrCached}`;
    }

    return `请归档邮件：${email.subject}\n\n发件人：${fromDisplay}\n发件时间：${email.sentAt.toISOString()}\n\n内容已缓存：${JSON.stringify(contentOrCached)}`;
  }

  private async startArchiveSession(
    conversation: Conversation,
    email: EmailEntity,
    userContent: string,
    agent: Agent,
  ): Promise<void> {
    const conversationId = conversation.id;

    // Set TraceContext for this conversation
    TraceContext.update({
      conversationId,
      userId: conversation.userId,
      traceId: conversationId,
    });
    TraceContext.freeze();

    // Create session BEFORE building memory to avoid race with frontend SSE
    const session = await this.chatService.acquireSession(conversationId);
    if (!session) {
      throw new Error(`Failed to acquire session for ${conversationId}`);
    }

    const memory = await this.chatService.buildMemory(
      agent,
      conversation.config!,
      {
        role: Role.USER,
        content: userContent,
        meta: { emailId: email.id },
      },
    );

    await this.chatService.updateSessionPhase(
      conversationId,
      'running',
      agent.id,
    );

    const [assistantMessage] = await this.conversationService.batchAddMessages(
      conversationId,
      [{ role: Role.ASSIST, content: '', createdAt: new Date() }],
    );

    const pendingMessage = new PendingMessage(assistantMessage, message =>
      this.conversationService.updateMessage(
        message.id,
        message.content,
        message.meta,
      ),
    );
    session.bindPendingMessage(pendingMessage);

    this.chatService.runSession(session, agent, memory, conversation.config);
  }
}
