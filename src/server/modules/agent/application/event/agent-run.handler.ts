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
import { AgentService } from '../service/agent.service';
import { ToolIds } from '@/shared/constants';
import type { LlmMessage } from '@/shared/types/entities';
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
    @inject(AgentService) private agentService: AgentService,
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
      effectiveHistory,
    } = event.payload;
    const runId = generateId('run');
    const workDir = await this.workspaceService.getWorkDir(conversationId);
    // conv 适配：把 effectiveHistory 转成 agent 种子格式，并取 conv 默认 ToolSet（全集）。
    const seed = buildIterMessages(effectiveHistory);
    const toolSet = this.agentService.buildToolSet();

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
      for await (const enriched of this.executor.launch({
        runId,
        workDir,
        userConfig,
        systemPrompt,
        seed,
        toolSet,
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

/**
 * 历史回复重建为扁平的 response_user 调用，保持与当前 ReAct 输出格式一致。
 * conv→agent 种子格式转换（assistant 文本 → response_user tool-call JSON），仅在 conv 适配层使用。
 */
function buildIterMessages(messages: LlmMessage[]): LlmMessage[] {
  return messages.map(msg =>
    msg.role === 'assistant'
      ? {
          role: 'assistant' as const,
          content: JSON.stringify({
            tool: ToolIds.RESPONSE_USER,
            input: { message: msg.content },
          }),
        }
      : { role: msg.role, content: msg.content },
  );
}
