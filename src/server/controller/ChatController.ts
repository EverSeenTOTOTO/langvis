import {
  CancelChatRequestDto,
  StartChatRequestDto,
} from '@/shared/dto/controller';
import type { Request, Response } from 'express';
import { container, inject } from 'tsyringe';
import { SSEServerTransport } from '../core/transport';
import { TraceContext } from '../core/TraceContext';
import type { Agent } from '../modules/agent/domain/agent.base';
import { AgentRun } from '../modules/agent/domain/agent-run.entity';
import { resolveEffectiveConfig } from '../modules/agent/domain/effective-config';
import { MEMORY_SERVICE, CACHE_PORT } from '../modules/agent/agent.di-tokens';
import type { MemoryService } from '../modules/memory/domain/memory-service';
import type { CachePort } from '../modules/memory/ports/cache.port';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { body, param, request, response } from '../decorator/param';
import { AuthService } from '../service/AuthService';
import { ChatService } from '../service/ChatService';
import { ConversationService } from '../service/ConversationService';
import { ProviderService } from '../service/ProviderService';
import { generateId } from '@/shared/utils';

@controller('/api/chat')
export default class ChatController {
  constructor(
    @inject(ConversationService)
    private conversationService: ConversationService,
    @inject(ChatService)
    private chatService: ChatService,
    @inject(AuthService)
    private authService: AuthService,
    @inject(ProviderService)
    private providerService: ProviderService,
  ) {}

  @api('/sse/:conversationId', { method: 'get' })
  async initSSE(
    @param('conversationId') conversationId: string,
    @request() req: Request,
    @response() res: Response,
  ) {
    const session = await this.chatService.acquireSession(conversationId);
    if (!session) {
      return res.sendStatus(204);
    }

    const transport = new SSEServerTransport(req, res);

    transport.addEventListener('disconnect', () => {
      req.log.info('SSE connection closed:', conversationId);
      session.handleDisconnect();
    });

    transport.addEventListener('error', (e: CustomEvent<string>) => {
      req.log.error('SSE connection error:', e.detail);
    });

    session.attachTransport(transport);

    req.log.info('SSE connection established', { sessionId: conversationId });

    return;
  }

  @api('/cancel/:conversationId', { method: 'post' })
  async cancelChat(
    @param('conversationId') conversationId: string,
    @body() dto: CancelChatRequestDto,
    @request() req: Request,
    @response() res: Response,
  ) {
    const session = this.chatService.getSession(conversationId);

    if (
      !session ||
      (session.phase !== 'active' && session.phase !== 'waiting')
    ) {
      return res.status(404).json({
        error: `No active session for conversation ${conversationId}`,
      });
    }

    session.cancelAllMessages(dto.reason ?? 'Cancelled by user');

    req.log.info(
      `Cancelled streaming for conversation ${conversationId}, message ${dto.messageId}`,
    );

    return res.status(200).json({ success: true });
  }

  @api('/cancel/:conversationId/:messageId', { method: 'post' })
  async cancelMessage(
    @param('conversationId') conversationId: string,
    @param('messageId') messageId: string,
    @body() _dto: { reason?: string },
    @request() req: Request,
    @response() res: Response,
  ) {
    const session = this.chatService.getSession(conversationId);

    if (!session) {
      return res.status(404).json({
        error: `No session for conversation ${conversationId}`,
      });
    }

    const run = session.getRun(messageId);
    if (!run || run.isTerminated) {
      return res.status(404).json({
        error: `No active message ${messageId}`,
      });
    }

    session.cancelMessage(messageId);

    req.log.info(
      `Cancelled message ${messageId} for conversation ${conversationId}`,
    );

    return res.status(200).json({ success: true });
  }

  @api('/start/:conversationId', { method: 'post' })
  async chat(
    @param('conversationId') conversationId: string,
    @body() dto: StartChatRequestDto,
    @request() req: Request,
    @response() res: Response,
  ) {
    const session = this.chatService.getSession(conversationId);

    if (!session) {
      return res.status(400).json({
        error: 'SSE connection not established',
      });
    }

    const conversation =
      await this.conversationService.getConversationById(conversationId);

    if (!conversation) {
      return res
        .status(400)
        .json({ error: `Conversation ${conversationId} not found` });
    }

    let agent: Agent;
    try {
      agent = container.resolve(conversation.config!.agent) as Agent;
    } catch {
      return res
        .status(400)
        .json({ error: `Agent ${conversation.config!.agent} not found` });
    }

    // Verify user is authenticated
    const userId = await this.authService.getUserId(req);

    if (userId !== conversation.userId) {
      return res.status(401).json({
        error: `Mismatched conversation user: ${userId}`,
      });
    }

    TraceContext.update({
      conversationId,
      userId,
    });

    // Prepare turn messages
    const { messages, assistantId } = await this.chatService.prepareTurn({
      conversationId,
      userId: conversation.userId,
      systemPrompt: agent.systemPrompt.build(),
      userMessage: {
        role: dto.role,
        content: dto.content,
        attachments: dto.attachments,
      },
    });

    // Update TraceContext with messageId
    TraceContext.update({
      messageId: assistantId,
      traceId: assistantId,
    });
    TraceContext.freeze();

    // Resolve EffectiveConfig
    const effectiveConfig = resolveEffectiveConfig(
      agent.config,
      {
        agentId: agent.id,
        config: conversation.config ?? {},
      },
      this.providerService,
      agent.systemPrompt.build(),
    );

    // Create AgentRun
    const memoryService = container.resolve<MemoryService>(MEMORY_SERVICE);
    const cachePort = container.resolve<CachePort>(CACHE_PORT);

    const run = new AgentRun(
      generateId('run'),
      assistantId,
      effectiveConfig,
      memoryService,
      cachePort,
      messages,
    );

    session.registerRun(run);

    res.status(200).json({ success: true, messageId: assistantId });

    this.chatService.runSession(session, agent, run);

    return;
  }

  @api('/session/:conversationId')
  async getSessionState(
    @param('conversationId') conversationId: string,
    @response() res: Response,
  ) {
    const state = await this.chatService.getSessionState(conversationId);

    return res.status(200).json(state ? { phase: state.phase } : null);
  }
}
