import { Inject } from '@nestjs/common';
import { generateId } from '@/shared/utils';
import { EventsHandler, EventBus } from '@nestjs/cqrs';
import { TurnInitiated } from '@/server/modules/conversation/contracts';
import type { RunEventPayload } from '@/server/modules/agent/contracts';
import {
  RunStarted,
  RunEvent,
  RunCompleted,
} from '@/server/modules/agent/contracts';
import { AgentRunExecutor } from '../service/agent-run-executor';
import { AgentService } from '../service/agent.service';
import Logger from '@/server/utils/logger';

// AgentRunHandler —— TurnInitiated 的订阅者，**只驱动 agent 执行**，不感知会话。
@EventsHandler(TurnInitiated)
export class AgentRunHandler {
  private readonly logger = Logger.child({ source: 'AgentRunHandler' });

  constructor(
    @Inject(AgentRunExecutor) private executor: AgentRunExecutor,
    @Inject(AgentService) private agentService: AgentService,
    @Inject(EventBus) private eventBus: EventBus,
  ) {}

  async handle(event: TurnInitiated): Promise<void> {
    const {
      conversationId,
      assistantMessage,
      runtimeConfig,
      effectiveHistory,
      workDir,
    } = event.payload;
    const runId = generateId('run');
    const startTime = Date.now();
    // 全程 try/finally：RunStarted 前的失败（如 buildToolSet）也必须发 RunCompleted，
    // 否则 conv 侧 startingTurns/activeRuns 永不清理（幻影活跃 run，后续消息全部死排队）。
    try {
      // effectiveHistory 即 agent 种子（createRun 经 restoreReactMessage 还原）；取 conv 默认 ToolSet（全集）。
      const toolSet = this.agentService.buildToolSet();

      this.eventBus.publish(
        new RunStarted(conversationId, {
          conversationId,
          messageId: assistantMessage.id,
          runId,
        }),
      );

      for await (const enriched of this.executor.launch({
        runId,
        workDir,
        conversationId,
        runtimeConfig,
        seed: effectiveHistory,
        toolSet,
        interactive: true,
      })) {
        this.eventBus.publish(
          new RunEvent(runId, {
            conversationId,
            messageId: assistantMessage.id,
            event: enriched,
          } satisfies RunEventPayload),
        );
      }
    } finally {
      this.eventBus.publish(
        new RunCompleted(conversationId, {
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
