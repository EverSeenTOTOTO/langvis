import { inject } from 'tsyringe';
import { generateId } from '@/shared/utils';
import type { DomainEvent } from '@/server/libs/ddd';
import { createDomainEvent, EventBus } from '@/server/libs/ddd';
import {
  TurnInitiated,
  RunCompleted,
} from '@/server/modules/conversation/contracts';
import type { TurnInitiatedPayload } from '@/server/modules/conversation/contracts';
import { AgentRunExecutor } from '../service/agent-run-executor';
import { eventHandler } from '@/server/decorator/handler';
import Logger from '@/server/utils/logger';
import { ChatService } from '@/server/modules/conversation/application/service/chat.service';
import { SessionManager } from '@/server/modules/conversation/application/service/session-manager';
import { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';
import { AGENT_RUN_REPOSITORY } from '../../agent.di-tokens';
import type { AgentRunRepositoryPort } from '../../domain/port/agent-run.repository.port';
import { AgentRun } from '../../domain/model/agent-run.entity';
import { AgentRunContext } from '../../domain/port/agent-run-context.port';

@eventHandler(TurnInitiated)
export class AgentRunHandler {
  private readonly logger = Logger.child({ source: 'AgentRunHandler' });

  constructor(
    @inject(ChatService)
    private conversationService: ChatService,
    @inject(SessionManager)
    private sessionManager: SessionManager,
    @inject(AgentRunExecutor)
    private executor: AgentRunExecutor,
    @inject(WorkspaceService)
    private workspaceService: WorkspaceService,
    @inject(EventBus)
    private eventBus: EventBus,
    @inject(AGENT_RUN_REPOSITORY)
    private agentRunRepo: AgentRunRepositoryPort,
  ) {}

  async handle(
    event: DomainEvent<string, TurnInitiatedPayload>,
  ): Promise<void> {
    const { conversationId, assistantMessage, userConfig, systemPrompt } =
      event.payload;

    const history = await this.conversationService.getHistoryMessages(
      conversationId,
      assistantMessage.id,
    );

    const workDir = await this.workspaceService.getWorkDir(conversationId);

    const { run, ctx } = this.executor.createRun({
      runId: generateId('run'),
      workDir,
      userConfig,
      systemPrompt,
      historyMessages: history,
    });

    this.sessionManager.registerRun(conversationId, assistantMessage.id, run);

    this.conversationService.persistAgentRunId(assistantMessage.id, run.runId);

    // Create initial agent_runs row (Agent BC persistence)
    await this.agentRunRepo.save({
      id: run.runId,
      status: 'running',
      events: [],
      config: {
        systemPrompt: run.config.systemPrompt,
        tools: run.config.tools,
        contextSize: run.config.contextSize,
        runtimeConfig: run.config.runtimeConfig,
      },
      startedAt: new Date(),
      completedAt: null,
    });

    await this.executeRun(conversationId, assistantMessage.id, run, ctx);
  }

  private async executeRun(
    conversationId: string,
    messageId: string,
    run: AgentRun,
    ctx: AgentRunContext,
  ): Promise<void> {
    this.logger.info(`Starting agent run`, {
      sessionId: conversationId,
      messageId,
    });

    const startTime = Date.now();

    try {
      for await (const enriched of this.executor.execute(run, ctx)) {
        this.sessionManager.processRunEvent(
          conversationId,
          messageId,
          enriched,
        );
      }
    } finally {
      this.eventBus.dispatch(
        RunCompleted,
        createDomainEvent(RunCompleted, conversationId, {
          conversationId,
          messageId,
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
