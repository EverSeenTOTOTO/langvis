import { inject } from 'tsyringe';
import { generateId } from '@/shared/utils';
import type { DomainEvent } from '@/server/libs/ddd';
import { TurnInitiated } from '@/server/modules/conversation/contracts';
import type { TurnInitiatedPayload } from '@/server/modules/conversation/contracts';
import { AgentRun } from './domain/agent-run.entity';
import { AgentService } from './application/agent.service';
import { eventHandler } from '@/server/decorator/handler';
import Logger from '@/server/utils/logger';
import { ConversationService } from '@/server/modules/conversation/application/conversation.service';
import { MESSAGE_REPOSITORY } from '@/server/modules/conversation/conversation.di-tokens';
import type { MessageRepositoryPort } from '@/server/modules/conversation/database/message.repository.port';
import { WorkspaceService } from '@/server/libs/infrastructure/workspace.service';

@eventHandler(TurnInitiated)
export class AgentRunHandler {
  private readonly logger = Logger.child({ source: 'AgentRunHandler' });

  constructor(
    @inject(ConversationService)
    private conversationService: ConversationService,
    @inject(AgentService)
    private agentService: AgentService,
    @inject(MESSAGE_REPOSITORY)
    private messageRepo: MessageRepositoryPort,
    @inject(WorkspaceService)
    private workspaceService: WorkspaceService,
  ) {}

  async handle(
    event: DomainEvent<string, TurnInitiatedPayload>,
  ): Promise<void> {
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

    const conv = this.conversationService.getChat(conversationId);
    if (conv) {
      conv.startTurn(assistantMessage.id);
      this.conversationService.handleDomainEvents(conv);
    }

    // 注册 run
    this.conversationService.registerRun(
      conversationId,
      assistantMessage.id,
      run,
    );

    // 桥接：run 事件 → ConversationService
    run.on('run:event', evt => {
      this.conversationService.applyRunEvent(conversationId, evt);
      this.conversationService.sendRunFrame(conversationId, evt);
    });

    // 持久化 agentRunId
    this.messageRepo
      .update(assistantMessage.id, { agentRunId: run.runId })
      .catch(err => {
        this.logger.warn('Failed to persist agentRunId', err);
      });

    await this.executeRun(conversationId, run, conv);
  }

  private async executeRun(
    conversationId: string,
    run: AgentRun,
    conv?: ReturnType<ConversationService['getChat']>,
  ): Promise<void> {
    this.logger.info(`Starting agent=${run.agent.id}`, {
      sessionId: conversationId,
      messageId: run.messageId,
    });

    const startTime = Date.now();

    try {
      await run.execute();
    } finally {
      // 最终持久化（从 PendingMessage snapshot 拿数据）
      const snapshot = conv?.getPendingSnapshot();
      if (snapshot) {
        await this.messageRepo.update(run.messageId, {
          content: snapshot.content,
          steps: snapshot.steps,
          agentRunId: run.runId,
          status: snapshot.status,
        });
      }

      // Finalize run
      this.conversationService.finalizeRun(conversationId, run.messageId);
      if (conv) {
        conv.completeTurn(run.messageId);
        this.conversationService.handleDomainEvents(conv);
      }

      const totalTime = Date.now() - startTime;
      const contentLength = snapshot?.content.length ?? 0;
      this.logger.info(
        `Agent completed: totalTime=${totalTime}ms content=${contentLength} session=${conversationId}`,
      );
    }
  }
}
