import {
  CancelChatRequestDto,
  StartChatRequestDto,
} from '@/shared/dto/controller';
import { Role } from '@/shared/entities/Message';
import { ConversationConfig } from '@/shared/types';
import chalk from 'chalk';
import type { Request, Response } from 'express';
import { container, inject } from 'tsyringe';
import type { Agent } from '../core/agent';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { body, param, request, response } from '../decorator/param';
import { ConversationService } from '../service/ConversationService';
import { SSEService } from '../service/SSEService';

@controller('/api/chat')
export default class ChatController {
  constructor(
    @inject(SSEService)
    private sseService: SSEService,

    @inject(ConversationService)
    private conversationService: ConversationService,
  ) {}

  @api('/sse/:conversationId', { method: 'get' })
  async initSSE(
    @param('conversationId') conversationId: string,
    @request() req: Request,
    @response() res: Response,
  ) {
    this.sseService.initSSEConnection(conversationId, res);

    req.on('close', () => {
      req.log.info('SSE connection closed:', conversationId);
      this.sseService.closeSSEConnection(conversationId);
    });

    req.on('error', err => {
      const isNormalClose =
        err.message === 'aborted' || (err as any).code === 'ECONNRESET';
      if (!isNormalClose) {
        req.log.error('SSE connection error:', err);
      }
    });
  }

  @api('/cancel/:conversationId', { method: 'post' })
  async cancelChat(
    @param('conversationId') conversationId: string,
    @body() dto: CancelChatRequestDto,
    @request() req: Request,
    @response() res: Response,
  ) {
    const cancelled = await this.conversationService.cancelStream(
      dto.messageId,
      dto.reason,
    );

    if (!cancelled) {
      return res.status(404).json({
        error: `No active stream found for message ${dto.messageId}`,
      });
    }

    req.log.info(
      `Cancelled streaming for conversation ${conversationId}, message ${dto.messageId}`,
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
    const conversation =
      await this.conversationService.getConversationById(conversationId);

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

    await this.startAgent(
      req,
      conversation.config as ConversationConfig,
      dto.role,
      dto.content,
    );

    return res.status(200).json({ success: true });
  }

  private async startAgent(
    req: Request,
    config: ConversationConfig,
    userRole: Role,
    userContent: string,
  ) {
    const { conversationId } = req.params;

    req.log.info(
      `Starting agent call for conversation ${conversationId}, agent: ${chalk.yellow(config.agent)}`,
    );

    const agent = container.resolve(config.agent) as Agent;

    if (!agent) {
      req.log.error(`Agent ${chalk.yellow(config.agent)} not registered.`);
      return;
    }

    // Get existing messages from database
    const messages =
      await this.conversationService.getMessagesByConversationId(
        conversationId,
      );

    // Prepare messages to batch insert with explicit timestamps to ensure order
    const baseTimestamp = Date.now();
    const messagesToInsert: Array<{
      role: Role;
      content: string;
      meta?: Record<string, any> | null;
      createdAt: Date;
    }> = [];

    let timestampOffset = 0;

    // Add system prompt if needed
    if (typeof agent.getSystemPrompt === 'function' && messages.length == 0) {
      const systemPrompt = await agent.getSystemPrompt();
      if (systemPrompt) {
        messagesToInsert.push({
          role: Role.SYSTEM,
          content: systemPrompt,
          createdAt: new Date(baseTimestamp + timestampOffset++),
        });
      }
    }

    // Add user message
    messagesToInsert.push({
      role: userRole,
      content: userContent,
      createdAt: new Date(baseTimestamp + timestampOffset++),
    });

    // Add initial assistant message for streaming
    messagesToInsert.push({
      role: Role.ASSIST,
      content: '',
      meta: { loading: true },
      createdAt: new Date(baseTimestamp + timestampOffset++),
    });

    // Batch insert all messages at once
    const insertedMessages = await this.conversationService.batchAddMessages(
      conversationId,
      messagesToInsert,
    );
    messages.push(...insertedMessages);

    // Get the assistant message (last inserted message) for streaming
    const assistantMessage = insertedMessages[insertedMessages.length - 1];

    // Create streaming writer for the assistant message
    const writer = await this.conversationService.createStreamForMessage(
      conversationId,
      assistantMessage,
    );

    // Only pass messages except the empty assistant message to agent
    const messagesForAgent = messages.slice(0, -1);

    agent
      .streamCall(messagesForAgent, writer, config)
      .catch(e => writer.abort(e));
  }
}
