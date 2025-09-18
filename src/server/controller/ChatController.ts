import { Message, Role } from '@/shared/entities/Message';
import type { Request, Response } from 'express';
import { pick } from 'lodash-es';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { inject, singleton } from 'tsyringe';
import { container } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { SSEService } from '../service/ChatService';
import { ConversationService } from '../service/ConversationService';
import { ConversationConfig } from '@/shared/types';
import type { Agent, AgentStreamCallContext } from '../core/agent';
import { createPeriodicSaveStream } from '../utils/streamUtils';

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

    const message = await this.conversationService.addMessageToConversation(
      conversationId,
      role as Role,
      content,
    );
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

    this.startAgent(req, conversation.config as ConversationConfig);

    if (!message) {
      return res
        .status(404)
        .json({ error: `Conversation ${conversationId} not found` });
    }

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
    let message: Message | null = null;

    // Create a custom WritableStream with periodic save capability
    const outputStream = createPeriodicSaveStream({
      onChunk: async (chunk: string, fullContent: string) => {
        if (!fullContent) {
          req.log.info(
            `First chunk received for agent call in conversation ${conversationId}, time taken: ${Date.now() - start}ms`,
          );

          // Create initial message with empty content
          this.conversationService
            .addMessageToConversation(conversationId, Role.ASSIST, '')
            .then(msg => {
              message = msg;
            });
        }

        this.sseService.sendToConversation(conversationId, {
          type: 'completion_delta',
          content: chunk,
        });
      },
      // onComplete handler - called when stream is complete
      onComplete: async (finalContent: string) => {
        // Ensure final content is saved
        if (message) {
          try {
            await this.conversationService.updateMessage(
              message.id,
              finalContent,
            );

            req.log.info(
              `Final content saved for conversation ${conversationId}`,
            );
          } catch (error) {
            req.log.error(
              `Failed to save final content for conversation ${conversationId}:`,
              error,
            );
          }
        }

        // Send completion done message
        this.sseService.sendToConversation(conversationId, {
          type: 'completion_done',
        });

        req.log.info(
          `Agent call finished for conversation ${conversationId}, total time: ${Date.now() - start}ms`,
        );
      },
      onError: (reason: unknown) => {
        req.log.error(
          `Agent call canceled for conversation ${conversationId}:`,
          reason,
        );
      },

      // Save progress periodically to reduce database pressure while maintaining consistency
      saveInterval: 10,
      onPeriodicSave: async (periodicContent: string) => {
        if (message) {
          try {
            await this.conversationService.updateMessage(
              message.id,
              periodicContent,
            );
            req.log.info(`Saved progress for conversation ${conversationId}`);
          } catch (error) {
            req.log.error(
              `Failed to save progress for conversation ${conversationId}:`,
              error,
            );
          }
        }
      },
    });

    try {
      const agent = container.resolve(config.agent) as Agent;

      await agent.streamCall(
        {
          ...config,
          conversationId,
          outputStream,
        } as AgentStreamCallContext,
        {
          messages: (messages || []).map(each =>
            pick(each, ['role', 'content']),
          ) as ChatCompletionMessageParam[],
        },
      );
    } catch (error: unknown) {
      req.log.error(`Error calling agent ${config.agent}:`, error);
      this.sseService.sendToConversation(conversationId, {
        type: 'completion_error',
        error: `Error calling agent: ${(error as Error).message || 'Unknown error'}`,
      });
    }
  }
}
