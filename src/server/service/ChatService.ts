import { Message, Role } from '@/shared/entities/Message';
import { AgentEvent } from '@/shared/types';
import type { Request } from 'express';
import { globby } from 'globby';
import { omit } from 'lodash-es';
import { container, inject } from 'tsyringe';
import { Agent } from '../core/agent';
import { Memory } from '../core/memory';
import { registerMemory } from '../decorator/core';
import { service } from '../decorator/service';
import { isProd } from '../utils';
import Logger from '../utils/logger';
import { AuthService } from './AuthService';
import { ConversationService } from './ConversationService';
import { SSEService } from './SSEService';

@service()
export class ChatService {
  private readonly logger = Logger.child({ source: 'ChatService' });
  private activeAgents: Map<string, AbortController> = new Map();

  constructor(
    @inject(SSEService)
    private sseService: SSEService,

    @inject(AuthService)
    private authService: AuthService,

    @inject(ConversationService)
    private conversationService: ConversationService,
  ) {
    const suffix = isProd ? '.js' : '.ts';
    const pattern = `./${isProd ? 'dist' : 'src'}/server/core/memory/*/index${suffix}`;

    globby(pattern, {
      cwd: process.cwd(),
      absolute: true,
    })
      .then(memoryPaths => {
        return Promise.all(
          memoryPaths.map(async memoryPath => {
            const { default: clazz } = await import(memoryPath);

            registerMemory(clazz);
          }),
        );
      })
      .catch(error => {
        this.logger.error('Failed to register memory modules:', error);
      });
  }

  async cancelAgent(conversationId: string, reason?: string): Promise<boolean> {
    const controller = this.activeAgents.get(conversationId);

    if (!controller) return false;

    try {
      controller.abort(new Error(reason ?? 'Cancelled by user'));
      return true;
    } catch (error) {
      this.logger.error(
        `Failed to cancel agent for conversation ${conversationId}:`,
        error,
      );
      return false;
    }
  }

  async consumeAgentStream(
    conversationId: string,
    message: Message,
    generator: AsyncGenerator<AgentEvent, void, void>,
    controller: AbortController,
  ): Promise<void> {
    const context = {
      message,
      conversationId,
      startTime: Date.now(),
      firstChunk: true,
      chunkStartTime: Date.now(),
    };

    this.activeAgents.set(conversationId, controller);

    try {
      for await (const event of generator) {
        if (controller.signal.aborted) {
          break;
        }

        switch (event.type) {
          case 'start':
            this.logger.info(
              `Agent ${event.agentId} started for conversation ${conversationId}`,
            );
            break;

          case 'delta':
            if (context.firstChunk) {
              this.logger.info(
                `First chunk received for conversation ${conversationId}, time taken: ${Date.now() - context.startTime}ms`,
              );
              context.chunkStartTime = Date.now();
              context.message.meta = {
                ...context.message.meta,
                streaming: true,
                loading: false,
              };
              this.sseService.sendToConversation(conversationId, {
                type: 'completion_delta',
                meta: context.message.meta!,
              });
              context.firstChunk = false;
            }
            context.message.content += event.content;
            this.logger.debug(
              `Sending delta content (length: ${event.content.length}): ${event.content.substring(0, 50)}...`,
            );
            this.sseService.sendToConversation(conversationId, {
              type: 'completion_delta',
              content: event.content,
            });
            break;

          case 'meta':
            context.message.meta = {
              ...context.message.meta,
              ...event.meta,
              loading: false,
            };
            this.sseService.sendToConversation(conversationId, {
              type: 'completion_delta',
              meta: context.message.meta!,
            });
            break;

          case 'end': {
            const chunkElapsed = Date.now() - context.chunkStartTime;
            this.logger.info(
              `Agent ${event.agentId} ended for conversation ${conversationId}, transmit time: ${chunkElapsed}ms`,
            );
            break;
          }

          case 'error':
            throw event.error;
        }
      }

      this.activeAgents.delete(conversationId);
      await this.conversationService.updateMessage(
        context.message.id,
        context.message.content,
        omit(context.message.meta, ['loading', 'streaming']),
      );

      this.logger.info(
        `Agent call finished for conversation ${conversationId}, total time: ${Date.now() - context.startTime}ms`,
      );

      this.sseService.sendToConversation(conversationId, {
        type: 'completion_done',
      });
    } catch (error) {
      this.activeAgents.delete(conversationId);

      this.logger.error(
        `Streaming error for conversation ${conversationId}:`,
        error,
      );

      const content = (error as Error)?.message || 'Unknown error';
      try {
        await this.conversationService.updateMessage(
          context.message.id,
          content,
          {
            ...context.message.meta,
            loading: undefined,
            streaming: undefined,
            error: true,
          },
        );
      } catch (updateError) {
        this.logger.error('Failed to finalize streaming message:', updateError);
      }

      this.sseService.sendToConversation(conversationId, {
        type: 'completion_error',
        error: content,
      });
    }
  }

  async buildMemory(
    req: Request,
    agent: Agent,
    config: Record<string, any>,
    userMessage: {
      role: Role;
      content: string;
      meta?: Record<string, any> | null;
    },
  ): Promise<Memory> {
    const { conversationId } = req.params;
    const currentUserId = await this.authService.getUserId(req);

    const memory = container.resolve<Memory>(config?.memory?.type);

    memory.setConversationId(conversationId);
    memory.setUserId(currentUserId);

    const initMessages: {
      role: Role;
      content: string;
      meta?: Record<string, any> | null;
      createdAt: Date;
    }[] = [];
    const messages = await memory.summarize();

    // Add system prompt if needed
    if (typeof agent.getSystemPrompt === 'function' && messages.length == 0) {
      const systemPrompt = await agent.getSystemPrompt();
      if (systemPrompt) {
        initMessages.push({
          role: Role.SYSTEM,
          content: systemPrompt,
          createdAt: new Date(),
        });
      }
    }

    // Add user message
    initMessages.push({
      ...userMessage,
      createdAt: new Date(),
    });

    await memory.store(initMessages);

    return memory;
  }
}
