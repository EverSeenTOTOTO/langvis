import { Role } from '@/shared/entities/Message';
import { ConversationConfig } from '@/shared/types';
import type { Request, Response } from 'express';
import { v4 as uuid } from 'uuid';
import { container, inject, singleton } from 'tsyringe';
import type { Agent } from '../core/agent';
import { ChatMessage, ChatState } from '../core/ChatState';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { SSEService } from '../service/ChatService';
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

    const message = await this.conversationService.addMessageToConversation(
      conversationId,
      role as Role,
      content,
    );

    if (!message) {
      return res
        .status(404)
        .json({ error: `Conversation ${conversationId} not found` });
    }

    // Start agent processing in background, but handle errors to prevent unhandled rejections
    this.startAgent(req, conversation.config as ConversationConfig).catch(
      error => {
        req.log.error(
          `Error in agent processing for conversation ${conversationId}:`,
          error,
        );
      },
    );

    return res.status(201).json(message);
  }

  private async startAgent(req: Request, config: ConversationConfig) {
    const { conversationId } = req.params;
    const messages =
      await this.conversationService.getMessagesByConversationId(
        conversationId,
      );

    req.log.info(`Starting agent call for conversation ${conversationId}`);

    const start = Date.now();
    const agent = container.resolve(config.agent) as Agent;

    if (!agent) {
      req.log.error(
        `Agent ${config.agent} not found for conversation ${conversationId}`,
      );
      return;
    }

    // Create ChatState with existing messages
    const chatState = new ChatState(conversationId, [
      ...(typeof agent.getSystemPrompt === 'function'
        ? ([
            {
              id: uuid(),
              role: Role.SYSTEM,
              content: await agent.getSystemPrompt(),
            },
          ] as ChatMessage[])
        : []),
      ...messages,
    ]);

    // Create initial message with empty content and add to chat state
    const initialMessage =
      await this.conversationService.addMessageToConversation(
        conversationId,
        Role.ASSIST,
        '',
      );

    if (!initialMessage) {
      req.log.error(
        `Failed to create initial message for conversation ${conversationId}`,
      );
      return;
    }

    // Add the initial message to chat state
    chatState.addMessage(initialMessage);

    // Create a custom WritableStream with message consistency checks
    const outputStream = new WritableStream({
      write: async (chunk: string) => {
        // Check if current message is still the same as initial message
        if (chatState.currentMessage?.id !== initialMessage.id) {
          req.log.warn(
            `Stream aborted: current message changed during streaming for conversation ${conversationId}`,
          );
          throw new Error('Current message changed during streaming');
        }

        // Update the current message in chat state
        const currentContent = chatState.currentMessage.content || '';
        const newContent = currentContent + chunk;
        chatState.updateCurrentMessage(newContent);

        if (!currentContent) {
          req.log.info(
            `First chunk received for agent call in conversation ${conversationId}, time taken: ${Date.now() - start}ms`,
          );
        }

        this.sseService.sendToConversation(conversationId, {
          type: 'completion_delta',
          content: chunk,
        });
      },
      close: async () => {
        // Check if current message is still the same as initial message
        if (chatState.currentMessage?.id !== initialMessage.id) {
          req.log.warn(
            `Stream close aborted: current message changed during streaming for conversation ${conversationId}`,
          );
          return;
        }

        const finalContent = chatState.currentMessage.content || '';

        // Save final content to database
        try {
          await this.conversationService.updateMessage(
            initialMessage.id,
            finalContent,
          );
        } catch (error) {
          req.log.error(
            `Failed to save final content for conversation ${conversationId}:`,
            error,
          );
        }

        // Send completion done message
        this.sseService.sendToConversation(conversationId, {
          type: 'completion_done',
        });

        const elapsed = Date.now() - start;
        req.log.info(
          `Agent call finished for conversation ${conversationId}, total time: ${elapsed}ms, time per token: ${
            elapsed / (finalContent.length || 1)
          }ms`,
        );
      },
      abort: (reason: unknown) => {
        req.log.error(
          `Agent call canceled for conversation ${conversationId}:`,
          reason,
        );
      },
    });

    try {
      await agent.streamCall(chatState, outputStream);
    } catch (error: unknown) {
      req.log.error(`Error calling agent ${config.agent}:`, error);
      this.sseService.sendToConversation(conversationId, {
        type: 'completion_error',
        error: `Error calling agent: ${(error as Error)?.message || 'Unknown error'}`,
      });
    }
  }
}
