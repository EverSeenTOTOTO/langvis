import { inject } from 'tsyringe';
import { generateId } from '@/shared/utils';
import type { DomainEvent } from '@/server/libs/ddd';
import type { SSEFrame } from '@/shared/types/events';
import type { AgentEvent, StreamChunk } from '@/shared/types/events';
import { ChatStarted } from '@/server/modules/conversation/contracts';
import type { ChatStartedPayload } from '@/server/modules/conversation/contracts';
import { AgentRun } from './domain/agent-run.entity';
import { AgentService } from './application/agent.service';
import { eventHandler } from '@/server/decorator/handler';
import Logger from '@/server/utils/logger';
import { SessionManager } from '@/server/modules/conversation/session-manager';
import { MESSAGE_REPOSITORY } from '@/server/modules/conversation/conversation.di-tokens';
import type { MessageRepositoryPort } from '@/server/modules/conversation/database/message.repository.port';
import { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';

@eventHandler(ChatStarted)
export class AgentRunHandler {
  private readonly logger = Logger.child({ source: 'AgentRunHandler' });

  constructor(
    @inject(SessionManager)
    private sessionManager: SessionManager,
    @inject(AgentService)
    private agentService: AgentService,
    @inject(MESSAGE_REPOSITORY)
    private messageRepo: MessageRepositoryPort,
    @inject(WorkspaceService)
    private workspaceService: WorkspaceService,
  ) {}

  async handle(event: DomainEvent<string, ChatStartedPayload>): Promise<void> {
    const { conversationId, assistantMessage, agentBinding, systemPrompt } =
      event.payload;

    const allMessages =
      await this.messageRepo.findByConversationId(conversationId);
    const history = allMessages.filter(m => m.id !== assistantMessage.id);

    const workDir = await this.workspaceService.getWorkDir(conversationId);
    const run = this.agentService.createRun({
      runId: generateId('run'),
      messageId: assistantMessage.id,
      workDir,
      agentBinding,
      systemPrompt,
      historyMessages: history,
    });

    this.sessionManager.registerRun(conversationId, assistantMessage, run);

    this.messageRepo
      .update(assistantMessage.id, { agentRunId: run.runId })
      .catch(err => {
        this.logger.warn('Failed to persist agentRunId', err);
      });

    await this.stream(conversationId, run);
  }

  private async stream(conversationId: string, run: AgentRun): Promise<void> {
    this.logger.info(`Starting agent=${run.agent.id}`, {
      sessionId: conversationId,
      messageId: run.messageId,
    });

    const startTime = Date.now();
    let firstTokenTime: number | undefined;

    try {
      for await (const event of run.execute()) {
        if (run.signal.aborted) break;

        if (event.type === 'text_chunk' && !firstTokenTime) {
          firstTokenTime = Date.now();
          this.logger.info(
            `First token: ttft=${firstTokenTime - startTime}ms session=${conversationId}`,
          );
        }

        const frame = { ...event, messageId: run.messageId } as SSEFrame;

        if (!this.sessionManager.sendFrame(conversationId, frame)) {
          this.logger.warn(
            `SSE not connected for ${conversationId}, event persisted`,
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
        this.logger.info(`Agent execution aborted session=${conversationId}`);
      } else {
        this.logger.error(`Agent error session=${conversationId}`, {
          error: (err as Error)?.message || String(err),
          stack: (err as Error)?.stack,
        });
        const errEvent = run.fail((err as Error)?.message || String(err));
        this.sessionManager.sendFrame(conversationId, {
          ...errEvent,
          messageId: run.messageId,
        } as SSEFrame);
      }
    } finally {
      if (run.signal.aborted && !run.isTerminated) {
        try {
          const reason = (run.signal.reason as Error)?.message ?? 'Cancelled';
          const cancelEvent = run.cancel(reason);
          this.sessionManager.sendFrame(conversationId, {
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
      this.sessionManager.sendFrame(conversationId, usageFrame);

      // Persist final message state
      await this.messageRepo.update(run.messageId, {
        content: run.content,
        toolCallRecords: run.getToolCallRecords(),
        thoughts: run.toSnapshot().thoughts,
        agentRunId: run.runId,
        status: run.status,
      });

      // Finalize run
      this.sessionManager.finalizeRun(conversationId, run.messageId);

      const totalTime = Date.now() - startTime;
      const ttft = firstTokenTime ? firstTokenTime - startTime : null;
      const contentLength = run.content.length;
      const avgTokenTime = contentLength > 0 ? totalTime / contentLength : 0;
      this.logger.info(
        `Agent completed: totalTime=${totalTime}ms tokens=${contentLength} ttft=${ttft ?? 'N/A'}ms avgTokenTime=${avgTokenTime.toFixed(2)}ms session=${conversationId}`,
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
