import { inject } from 'tsyringe';
import { generateId } from '@/shared/utils';
import type { DomainEvent } from '@/server/libs/ddd';
import { createDomainEvent, EventBus } from '@/server/libs/ddd';
import {
  TurnInitiated,
  RunStarted,
  RunEvent,
  RunCompleted,
} from '@/server/modules/conversation/contracts';
import type {
  TurnInitiatedPayload,
  RunEventPayload,
} from '@/server/modules/conversation/contracts';
import { AgentRunExecutor } from '../service/agent-run-executor';
import { eventHandler } from '@/server/decorator/handler';
import Logger from '@/server/utils/logger';
import { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';

/**
 * AgentRunHandler —— TurnInitiated 的订阅者，**只驱动 agent 执行**，不感知会话。
 */
@eventHandler(TurnInitiated)
export class AgentRunHandler {
  private readonly logger = Logger.child({ source: 'AgentRunHandler' });

  constructor(
    @inject(AgentRunExecutor) private executor: AgentRunExecutor,
    @inject(WorkspaceService) private workspaceService: WorkspaceService,
    @inject(EventBus) private eventBus: EventBus,
  ) {}

  async handle(
    event: DomainEvent<string, TurnInitiatedPayload>,
  ): Promise<void> {
    const {
      conversationId,
      assistantMessage,
      userConfig,
      systemPrompt,
      historyMessages,
    } = event.payload;
    const runId = generateId('run');
    const workDir = await this.workspaceService.getWorkDir(conversationId);

    this.eventBus.dispatch(
      RunStarted,
      createDomainEvent(RunStarted, conversationId, {
        conversationId,
        messageId: assistantMessage.id,
        runId,
      }),
    );

    const startTime = Date.now();
    try {
      for await (const enriched of this.executor.run({
        runId,
        workDir,
        userConfig,
        systemPrompt,
        historyMessages,
      })) {
        this.eventBus.dispatch(
          RunEvent,
          createDomainEvent(RunEvent, runId, {
            conversationId,
            messageId: assistantMessage.id,
            event: enriched,
          } satisfies RunEventPayload),
        );
      }
    } finally {
      this.eventBus.dispatch(
        RunCompleted,
        createDomainEvent(RunCompleted, conversationId, {
          conversationId,
          messageId: assistantMessage.id,
          agentRunId: runId,
        }),
      );
      this.logger.info(
        `Agent run finished: totalTime=${Date.now() - startTime}ms session=${conversationId}`,
      );
    }
  }
}
