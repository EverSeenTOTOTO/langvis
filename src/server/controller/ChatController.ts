import { Role } from '@/shared/entities/Message';
import { ConversationConfig } from '@/shared/types';
import type { Request, Response } from 'express';
import { container, inject, singleton } from 'tsyringe';
import type { Agent } from '../core/agent';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { SSEService } from '../service/SSEService';
import { ConversationService } from '../service/ConversationService';

@singleton()
@controller('/api/chat')
export class ChatController {
  constructor(
    @inject(SSEService)
    private sseService: SSEService,

    @inject(ConversationService)
    private conversationService: ConversationService,
  ) {}

  @api('/sse/:conversationId', { method: 'get' })
  async initSSE(req: Request, res: Response) {
    const { conversationId } = req.params;

    this.sseService.initSSEConnection(conversationId, res);

    req.on('close', () => {
      req.log.info('SSE connection closed:', conversationId);
      this.sseService.closeSSEConnection(conversationId);
    });

    req.on('error', err => {
      req.log.error('SSE connection error:', err);
      this.sseService.closeSSEConnection(conversationId);
    });
  }

  @api('/start/:conversationId', { method: 'post' })
  async chat(req: Request, res: Response) {
    const { conversationId } = req.params;
    const { role, content } = req.body;

    if (!role || !content) {
      return res.status(400).json({ error: 'Role and content are required' });
    }

    // Validate role
    if (!Object.values(Role).includes(role as Role)) {
      return res.status(400).json({ error: `Invalid role: ${role}` });
    }

    const conversation =
      await this.conversationService.getConversationById(conversationId);

    // Validate that conversation and agent config exist
    if (!conversation) {
      return res
        .status(404)
        .json({ error: `Conversation ${conversationId} not found` });
    }

    if (
      !conversation.config ||
      !('agent' in conversation.config) ||
      !conversation.config.agent
    ) {
      return res.status(400).json({
        error: `Conversation ${conversationId} has no agent configured`,
      });
    }

    // Start agent processing in background, but handle errors to prevent unhandled rejections
    await this.startAgent(
      req,
      conversation.config as ConversationConfig,
      role as Role,
      content,
    ).catch(error => {
      req.log.error(
        `Error in agent processing for conversation ${conversationId}:`,
        error,
      );
    });

    // Return success immediately
    return res.status(200).json({ success: true });
  }

  private async startAgent(
    req: Request,
    config: ConversationConfig,
    userRole: Role,
    userContent: string,
  ) {
    const { conversationId } = req.params;

    req.log.info(`Starting agent call for conversation ${conversationId}`);

    const agent = container.resolve(config.agent) as Agent;

    if (!agent) {
      req.log.error(
        `Agent ${config.agent} not found for conversation ${conversationId}`,
      );
      return;
    }

    // Get existing messages from database
    const messages =
      await this.conversationService.getMessagesByConversationId(
        conversationId,
      );

    // Prepare conversation history with system prompt if needed
    if (typeof agent.getSystemPrompt === 'function' && messages.length == 0) {
      const systemPrompt = await agent.getSystemPrompt();

      // Save system prompt to database
      const systemMessage =
        await this.conversationService.addMessageToConversation(
          conversationId,
          Role.SYSTEM,
          systemPrompt,
        );

      if (systemMessage) {
        messages.push(systemMessage);
      }
    }

    // Save user message to database
    const userMessage = await this.conversationService.addMessageToConversation(
      conversationId,
      userRole,
      userContent,
    );

    if (userMessage) {
      messages.push(userMessage);
    }

    // Create streaming message with integrated WritableStream
    const stream = await this.conversationService.createMessageStream(
      conversationId,
      Role.ASSIST,
      '',
      { loading: true },
    );

    agent.streamCall(messages, stream);
  }
}
