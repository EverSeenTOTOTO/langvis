import type { SSEFrame } from '@/shared/types/events';
import { generateId } from '@/shared/utils';
import { inject } from 'tsyringe';
import type { Agent } from '../../agent/domain/agent.base';
import { AgentRun } from '../../agent/domain/agent-run.entity';
import { resolveEffectiveConfig } from '../../agent/domain/effective-config';
import type { AgentEvent, StreamChunk } from '@/shared/types/events';
import {
  MEMORY_SERVICE,
  CACHE_PORT,
  TOOL_RESOLVER,
} from '../../agent/agent.di-tokens';
import type { MemoryService } from '../../memory/domain/memory-service';
import type { CachePort } from '../../memory/ports/cache.port';
import type { ToolResolver } from '../../agent/domain/tool-resolver.port';
import { Conversation } from '../domain/conversation.entity';
import { service } from '@/server/decorator/service';
import Logger from '@/server/utils/logger';
import { SessionManager } from '../session-manager';
import { MESSAGE_REPOSITORY } from '../conversation.di-tokens';
import type { MessageRepositoryPort } from '../database/message.repository.port';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import { RunAgentSessionCommand } from './run-agent-session.command';

@service()
export class RunAgentSessionHandler {
  private readonly logger = Logger.child({ source: 'RunAgentSessionHandler' });

  constructor(
    @inject(SessionManager)
    private sessionManager: SessionManager,
    @inject(MESSAGE_REPOSITORY)
    private messageRepo: MessageRepositoryPort,
    @inject(ProviderService)
    private providerService: ProviderService,
    @inject(MEMORY_SERVICE)
    private memoryService: MemoryService,
    @inject(CACHE_PORT)
    private cachePort: CachePort,
    @inject(TOOL_RESOLVER)
    private toolResolver: ToolResolver,
  ) {}

  async prepare(command: RunAgentSessionCommand): Promise<{
    conversation: Conversation;
    run: AgentRun;
  }> {
    const { conversationId, agent, messages, assistantMessage, binding } =
      command;

    const conversation = this.sessionManager.getSession(conversationId);
    if (!conversation) throw new Error('No session');

    const effectiveConfig = resolveEffectiveConfig(
      agent.config,
      binding,
      this.providerService,
      agent.systemPrompt.build(),
    );

    const run = new AgentRun(
      generateId('run'),
      assistantMessage.id,
      effectiveConfig,
      this.memoryService,
      this.cachePort,
      this.toolResolver,
      messages,
    );

    conversation.registerRun(assistantMessage, run);
    this.sessionManager.handleDomainEvents(conversation);

    this.messageRepo
      .update(assistantMessage.id, {
        agentRunId: run.runId,
      })
      .catch(err => {
        this.logger.warn('Failed to persist agentRunId', err);
      });

    return { conversation, run };
  }

  async stream(
    conversation: Conversation,
    agent: Agent,
    run: AgentRun,
  ): Promise<void> {
    this.logger.info(`Starting agent=${agent.id}`, {
      sessionId: conversation.id,
      messageId: run.messageId,
    });

    const startTime = Date.now();
    let firstTokenTime: number | undefined;

    try {
      for await (const event of agent.call(run)) {
        if (run.signal.aborted) break;

        if (event.type === 'text_chunk' && !firstTokenTime) {
          firstTokenTime = Date.now();
          this.logger.info(
            `First token: ttft=${firstTokenTime - startTime}ms session=${conversation.id}`,
          );
        }

        const frame = { ...event, messageId: run.messageId } as SSEFrame;

        if (!conversation.send(frame)) {
          this.logger.warn(
            `SSE not connected for ${conversation.id}, event persisted`,
          );
        }

        this.projectToMessage(event, run.messageId, run).catch(err => {
          this.logger.warn(
            'Projection failed, will be corrected by final write',
            {
              messageId: run.messageId,
              eventType: event.type,
              error: (err as Error)?.message,
            },
          );
        });

        if (event.type === 'error') break;
      }
    } catch (err) {
      if (run.signal.aborted) {
        this.logger.info(`Agent execution aborted session=${conversation.id}`);
      } else {
        this.logger.error(`Agent error session=${conversation.id}`, {
          error: (err as Error)?.message || String(err),
          stack: (err as Error)?.stack,
        });
        const errEvent = run.fail((err as Error)?.message || String(err));
        conversation.send({
          ...errEvent,
          messageId: run.messageId,
        } as SSEFrame);
      }
    } finally {
      if (run.signal.aborted && !run.isTerminated) {
        try {
          const reason = (run.signal.reason as Error)?.message ?? 'Cancelled';
          const cancelEvent = run.cancel(reason);
          conversation.send({
            ...cancelEvent,
            messageId: run.messageId,
          } as SSEFrame);
        } catch {
          // Already terminated
        }
      }

      // Emit context_usage
      const usage = run.getContextUsage();
      const usageFrame: SSEFrame = {
        type: 'context_usage',
        messageId: run.messageId,
        seq: run.nextSeq(),
        at: Date.now(),
        used: usage.used,
        total: usage.total,
        reason: 'turn_completed',
      };
      conversation.send(usageFrame);

      // Persist final message state
      await this.messageRepo.update(run.messageId, {
        content: run.content,
        toolCallRecords: run.getToolCallRecords(),
        thoughts: run.toSnapshot().thoughts,
        agentRunId: run.runId,
        status: run.status,
      });

      // Finalize run in conversation
      conversation.finalizeRun(run.messageId);
      this.sessionManager.handleDomainEvents(conversation);

      const totalTime = Date.now() - startTime;
      const ttft = firstTokenTime ? firstTokenTime - startTime : null;
      const contentLength = run.content.length;
      const avgTokenTime = contentLength > 0 ? totalTime / contentLength : 0;
      this.logger.info(
        `Agent completed: totalTime=${totalTime}ms tokens=${contentLength} ttft=${ttft ?? 'N/A'}ms avgTokenTime=${avgTokenTime.toFixed(2)}ms session=${conversation.id}`,
      );
    }
  }

  private async projectToMessage(
    event: AgentEvent | StreamChunk,
    messageId: string,
    run: AgentRun,
  ): Promise<void> {
    switch (event.type) {
      case 'tool_result':
      case 'tool_error': {
        const toolCall = run.getToolCall(event.callId);
        if (toolCall) {
          await this.messageRepo.appendToolCallRecord(
            messageId,
            toolCall.toRecord(),
          );
        }
        break;
      }
      case 'thought': {
        await this.messageRepo.appendThought(messageId, event.content);
        break;
      }
    }
  }
}
