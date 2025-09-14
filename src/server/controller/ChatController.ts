import { Message, Role } from '@/shared/entities/Message';
import type { Request, Response } from 'express';
import { pick } from 'lodash-es';
import { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { inject, singleton } from 'tsyringe';
import { api } from '../decorator/api';
import { controller } from '../decorator/controller';
import { SSEService } from '../service/ChatService';
import { CompletionService } from '../service/CompletionService';
import { ConversationService } from '../service/ConversationService';
import { ConversationConfig } from '@/shared/types';

@singleton()
@controller('/api/chat')
export class ChatController {
  constructor(
    @inject(SSEService)
    private sseService: SSEService,

    @inject(ConversationService)
    private conversationService: ConversationService,

    @inject(CompletionService)
    private completionService: CompletionService,
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

    if (
      conversation?.config &&
      'agent' in conversation.config &&
      conversation.config.agent
    ) {
      this.startAgent(req, conversation.config as ConversationConfig);
    } else {
      this.startCompletion(req);
    }

    if (!message) {
      return res
        .status(404)
        .json({ error: `Conversation ${conversationId} not found` });
    }

    return res.status(201).json(message);
  }

  private async startCompletion(req: Request) {
    const { conversationId } = req.params;
    const messages =
      await this.conversationService.getMessagesByConversationId(
        conversationId,
      );

    req.log.info(`Starting completion for conversation ${conversationId}`);

    const start = Date.now();
    let content = '';

    // Create a custom WritableStream that handles the SSE sending
    const outputStream = new WritableStream({
      write: async (chunk: string) => {
        if (!content) {
          req.log.info(
            `First chunk received for conversation ${conversationId}, time taken: ${Date.now() - start}ms`,
          );
        }

        content += chunk;
        this.sseService.sendToConversation(conversationId, {
          type: 'completion_delta',
          content: chunk,
        });
      },
      close: async () => {
        req.log.info(
          `Received ${content.length} characters of content for conversation ${conversationId}`,
        );

        // Send completion done message
        this.sseService.sendToConversation(conversationId, {
          type: 'completion_done',
        });

        // Persist the completed message when stream closes
        await this.conversationService.addMessageToConversation(
          conversationId,
          Role.ASSIST,
          content,
        );

        req.log.info(
          `Stream completed for conversation ${conversationId}, total time: ${Date.now() - start}ms`,
        );
      },
      abort: (reason: any) => {
        req.log.error(
          `Stream aborted for conversation ${conversationId}:`,
          reason,
        );
      },
    });

    await this.completionService.streamChatCompletion(
      {
        conversationId,
        outputStream,
      },
      {
        messages: (messages || []).map(each =>
          pick(each, ['role', 'content']),
        ) as ChatCompletionMessageParam[],
      },
    );
  }

  private async startAgent(req: Request, config: ConversationConfig) {
    const { conversationId } = req.params;
    const messages =
      await this.conversationService.getMessagesByConversationId(
        conversationId,
      );

    req.log.info(`Starting agent call for conversation ${conversationId}`);

    const start = Date.now();
    let content = '';
    let message: Message | null = null;

    // Create a custom WritableStream that handles the SSE sending
    const outputStream = new WritableStream({
      write: async (chunk: string) => {
        if (!content) {
          req.log.info(
            `First chunk received for agent call in conversation ${conversationId}, time taken: ${Date.now() - start}ms`,
          );

          // Create initial message with empty content
          message = await this.conversationService.addMessageToConversation(
            conversationId,
            Role.ASSIST,
            '',
          );
        }

        content += chunk;
        this.sseService.sendToConversation(conversationId, {
          type: 'completion_delta',
          content: chunk,
        });

        // Update the message with accumulated content
        if (message) {
          await this.conversationService.updateMessage(message.id, content);
        }
      },
      close: async () => {
        // Send completion done message
        this.sseService.sendToConversation(conversationId, {
          type: 'completion_done',
        });

        req.log.info(
          `Agent call finished for conversation ${conversationId}, total time: ${Date.now() - start}ms`,
        );
      },
      abort: (reason: any) => {
        req.log.error(
          `Agent call canceled for conversation ${conversationId}:`,
          reason,
        );
      },
    });

    await this.completionService.streamAgentCall(
      {
        ...config,
        conversationId,
        outputStream,
      },
      {
        messages: (messages || []).map(each =>
          pick(each, ['role', 'content']),
        ) as ChatCompletionMessageParam[],
      },
    );
  }
}
