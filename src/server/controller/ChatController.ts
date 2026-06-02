import {
  CancelChatRequestDto,
  StartChatRequestDto,
} from '@/shared/dto/controller';
import type { AgentBinding } from '@/shared/types/agent';
import type { Request, Response } from 'express';
import { container, inject } from 'tsyringe';
import { SSEServerTransport } from '../core/transport';
import { TraceContext } from '../core/TraceContext';
import type { Agent } from '../modules/agent/domain/agent.base';
import { NoActiveRunError } from '../modules/conversation';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { body, param, request, response } from '../decorator/param';
import { AuthService } from '@/server/libs/infrastructure/auth.service';
import { CONVERSATION_REPOSITORY } from '../modules/conversation/conversation.di-tokens';
import type { ConversationRepositoryPort } from '../modules/conversation/database/conversation.repository.port';
import { SessionManager } from '../modules/conversation/session-manager';
import { StartChatTurnCommand } from '../modules/conversation/commands/start-chat-turn.command';
import { StartChatTurnHandler } from '../modules/conversation/commands/start-chat-turn.handler';
import { RunAgentSessionCommand } from '../modules/conversation/commands/run-agent-session.command';
import { RunAgentSessionHandler } from '../modules/conversation/commands/run-agent-session.handler';
import { GetSessionStateQuery } from '../modules/conversation/queries/get-session-state.query';
import { GetSessionStateHandler } from '../modules/conversation/queries/get-session-state.handler';

@controller('/api/chat')
export default class ChatController {
  constructor(
    @inject(CONVERSATION_REPOSITORY)
    private convRepo: ConversationRepositoryPort,
    @inject(SessionManager)
    private sessionManager: SessionManager,
    @inject(StartChatTurnHandler)
    private startChatTurnHandler: StartChatTurnHandler,
    @inject(RunAgentSessionHandler)
    private runAgentSessionHandler: RunAgentSessionHandler,
    @inject(GetSessionStateHandler)
    private getSessionStateHandler: GetSessionStateHandler,
    @inject(AuthService)
    private authService: AuthService,
  ) {}

  @api('/sse/:conversationId', { method: 'get' })
  async initSSE(
    @param('conversationId') conversationId: string,
    @request() req: Request,
    @response() res: Response,
  ) {
    const conversation =
      await this.sessionManager.acquireSession(conversationId);
    if (!conversation) {
      return res.sendStatus(204);
    }

    const transport = new SSEServerTransport(req, res);

    transport.addEventListener('disconnect', () => {
      req.log.info('SSE connection closed:', conversationId);
    });

    transport.addEventListener('error', (e: CustomEvent<string>) => {
      req.log.error('SSE connection error:', e.detail);
    });

    this.sessionManager.attachTransport(conversationId, transport);

    req.log.info('SSE connection established', {
      sessionId: conversationId,
    });

    return;
  }

  @api('/cancel/:conversationId', { method: 'post' })
  async cancelChat(
    @param('conversationId') conversationId: string,
    @body() dto: CancelChatRequestDto,
    @request() req: Request,
    @response() res: Response,
  ) {
    const conversation = this.sessionManager.getSession(conversationId);

    if (
      !conversation ||
      (conversation.phase !== 'active' && conversation.phase !== 'waiting')
    ) {
      return res.status(404).json({
        error: `No active session for conversation ${conversationId}`,
      });
    }

    this.sessionManager.cancelConversation(
      conversationId,
      dto.reason ?? 'Cancelled by user',
    );

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
    const conversation = this.sessionManager.getSession(conversationId);

    if (!conversation) {
      return res.status(404).json({
        error: `No session for conversation ${conversationId}`,
      });
    }

    try {
      this.sessionManager.cancelMessage(conversationId, messageId);
    } catch (e) {
      if (e instanceof NoActiveRunError) {
        return res.status(404).json({
          error: `No active message ${messageId}`,
        });
      }
      throw e;
    }

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
    const conversation = this.sessionManager.getSession(conversationId);

    if (!conversation) {
      return res.status(400).json({
        error: 'SSE connection not established',
      });
    }

    const dbConversation = await this.convRepo.findById(conversationId);

    if (!dbConversation) {
      return res
        .status(400)
        .json({ error: `Conversation ${conversationId} not found` });
    }

    const binding = this.extractBinding(dbConversation);

    let agent: Agent;
    try {
      agent = container.resolve(binding.agentId) as Agent;
    } catch {
      return res
        .status(400)
        .json({ error: `Agent ${binding.agentId} not found` });
    }

    // Verify user is authenticated
    const userId = await this.authService.getUserId(req);

    if (userId !== dbConversation.userId) {
      return res.status(401).json({
        error: `Mismatched conversation user: ${userId}`,
      });
    }

    TraceContext.update({
      conversationId,
      userId,
    });

    // Prepare turn messages
    const turnCommand = new StartChatTurnCommand(
      conversationId,
      dbConversation.userId,
      agent.systemPrompt.build(),
      undefined,
      {
        role: dto.role,
        content: dto.content,
        attachments: dto.attachments,
      },
      undefined,
    );

    const { messages, assistantId, assistantMessage } =
      await this.startChatTurnHandler.execute(turnCommand);

    // Update TraceContext with messageId
    TraceContext.update({
      messageId: assistantId,
      traceId: assistantId,
    });
    TraceContext.freeze();

    const runCommand = new RunAgentSessionCommand(
      conversationId,
      agent,
      messages,
      assistantMessage,
      binding,
    );

    const run = await this.runAgentSessionHandler.prepare(runCommand);

    res.status(200).json({ success: true, messageId: assistantId });

    this.runAgentSessionHandler.stream(conversationId, run);

    return;
  }

  @api('/session/:conversationId')
  async getSessionState(
    @param('conversationId') conversationId: string,
    @response() res: Response,
  ) {
    const query = new GetSessionStateQuery(conversationId);
    const state = await this.getSessionStateHandler.execute(query);

    return res.status(200).json(state ? { phase: state.phase } : null);
  }

  private extractBinding(conv: {
    config?: Record<string, any> | null;
  }): AgentBinding {
    const config = conv.config ?? {};
    const { agent: agentId, ...restConfig } = config as any;
    return { agentId: agentId ?? 'chat_agent', config: restConfig };
  }
}
