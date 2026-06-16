import { inject } from 'tsyringe';
import { generateId } from '@/shared/utils';
import type { DomainEvent } from '@/server/libs/ddd';
import { createDomainEvent, EventBus } from '@/server/libs/ddd';
import {
  TurnInitiated,
  RunCompleted,
} from '@/server/modules/conversation/contracts';
import type { TurnInitiatedPayload } from '@/server/modules/conversation/contracts';
import { AgentRun } from '../../domain/model/agent-run.entity';
import { AgentService } from '../service/agent.service';
import { eventHandler } from '@/server/decorator/handler';
import Logger from '@/server/utils/logger';
import { ConversationService } from '@/server/modules/conversation/application/service/conversation.service';
import { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';

@eventHandler(TurnInitiated)
export class AgentRunHandler {
  private readonly logger = Logger.child({ source: 'AgentRunHandler' });

  constructor(
    @inject(ConversationService)
    private conversationService: ConversationService,
    @inject(AgentService)
    private agentService: AgentService,
    @inject(WorkspaceService)
    private workspaceService: WorkspaceService,
    @inject(EventBus)
    private eventBus: EventBus,
  ) {}

  async handle(
    event: DomainEvent<string, TurnInitiatedPayload>,
  ): Promise<void> {
    const { conversationId, assistantMessage, agentBinding, systemPrompt } =
      event.payload;

    const history = await this.conversationService.getHistoryMessages(
      conversationId,
      assistantMessage.id,
    );

    const workDir = await this.workspaceService.getWorkDir(conversationId);
    const run = this.agentService.createRun({
      runId: generateId('run'),
      messageId: assistantMessage.id,
      workDir,
      agentBinding,
      systemPrompt,
      historyMessages: history,
    });

    this.conversationService.registerRun(
      conversationId,
      assistantMessage.id,
      run,
    );

    run.on('run:event', evt => {
      this.conversationService.processRunEvent(conversationId, evt);
    });

    this.conversationService.persistAgentRunId(assistantMessage.id, run.runId);

    await this.executeRun(conversationId, run);
  }

  private async executeRun(
    conversationId: string,
    run: AgentRun,
  ): Promise<void> {
    this.logger.info(`Starting agent=${run.agent.id}`, {
      sessionId: conversationId,
      messageId: run.messageId,
    });

    const startTime = Date.now();

    try {
      await run.execute();
    } finally {
      this.eventBus.emit(
        RunCompleted,
        createDomainEvent(RunCompleted, conversationId, {
          conversationId,
          messageId: run.messageId,
          agentRunId: run.runId,
        }),
      );

      const totalTime = Date.now() - startTime;
      this.logger.info(
        `Agent run finished: totalTime=${totalTime}ms session=${conversationId}`,
      );
    }
  }
}
