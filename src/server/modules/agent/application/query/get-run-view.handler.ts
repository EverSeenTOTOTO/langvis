import { inject } from 'tsyringe';
import { queryHandler } from '@/server/decorator/handler';
import { AgentRunExecutor } from '@/server/modules/agent/application/service/agent-run-executor';
import { AGENT_RUN_REPOSITORY } from '@/server/modules/agent/agent.di-tokens';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import {
  projectRun,
  type RunViewResult,
} from '@/server/modules/agent/application/service/run-projection';
import { GetRunViewQuery } from './run.queries';

/**
 * GetRunViewHandler —— 单一投影机制：任意 run（会话/父/子）的迭代视图都是
 * projectRun(RunEvents)。活跃 run 取内存事件流，否则回落持久化 events；不存在返回 null（→404）。
 * iterMessages 是内部瞬态，从不对外。
 */
@queryHandler(GetRunViewQuery)
export class GetRunViewHandler {
  constructor(
    @inject(AgentRunExecutor) private readonly executor: AgentRunExecutor,
    @inject(AGENT_RUN_REPOSITORY)
    private readonly agentRunRepo: AgentRunRepositoryPort,
  ) {}

  async execute(query: GetRunViewQuery): Promise<RunViewResult | null> {
    const live = this.executor.getActiveRun(query.runId);
    if (live) {
      return {
        runId: live.runId,
        status: live.currentStatus,
        view: projectRun([...live.eventStream]),
      };
    }

    const run = await this.agentRunRepo.findById(query.runId);
    if (!run) return null;
    return {
      runId: run.id,
      status: run.status,
      view: projectRun(run.events ?? []),
    };
  }
}
