import { inject } from 'tsyringe';
import { queryHandler } from '@/server/decorator/handler';
import { AgentRunExecutor } from '@/server/modules/agent/application/service/agent-run-executor';
import { AGENT_RUN_REPOSITORY } from '@/server/modules/agent/agent.di-tokens';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import type { EnrichedEvent } from '@/shared/types/events';
import { GetChildRunsQuery } from './run.queries';

export interface ChildRunSummary {
  runId: string;
  status: string;
  startedAt: Date | null;
  completedAt: Date | null;
}

/**
 * GetChildRunsHandler —— 选项 b（无 schema 变更）：从父 run 的 tool_progress 事件解析
 * call_subagents 吐出的 childRunId（去重保序），再批量取各 child run 摘要。
 * 父事件实时优先、repo 回落（tool_progress 虽不进 projectRun 步骤，但确在持久化 events 列里）。
 */
@queryHandler(GetChildRunsQuery)
export class GetChildRunsHandler {
  constructor(
    @inject(AgentRunExecutor) private readonly executor: AgentRunExecutor,
    @inject(AGENT_RUN_REPOSITORY)
    private readonly agentRunRepo: AgentRunRepositoryPort,
  ) {}

  async execute(query: GetChildRunsQuery): Promise<ChildRunSummary[]> {
    const events = await this.readParentEvents(query.parentRunId);
    if (!events) return [];

    const childRunIds: string[] = [];
    const seen = new Set<string>();
    for (const e of events) {
      if (e.type !== 'tool_progress') continue;
      const data = e.data as { childRunId?: unknown } | undefined;
      const id = data?.childRunId;
      if (typeof id === 'string' && !seen.has(id)) {
        seen.add(id);
        childRunIds.push(id);
      }
    }
    if (childRunIds.length === 0) return [];

    const runs = await this.agentRunRepo.findByIds(childRunIds);
    const byId = new Map(runs.map(r => [r.id, r]));
    // 保序（按发现顺序）；缺失的 run 保留 id、status 标 unknown。
    return childRunIds.map(id => {
      const r = byId.get(id);
      return {
        runId: id,
        status: r?.status ?? 'unknown',
        startedAt: r?.startedAt ?? null,
        completedAt: r?.completedAt ?? null,
      };
    });
  }

  private async readParentEvents(
    parentRunId: string,
  ): Promise<readonly EnrichedEvent[] | null> {
    const live = this.executor.getActiveRun(parentRunId);
    if (live) return live.eventStream;
    const run = await this.agentRunRepo.findById(parentRunId);
    return run?.events ?? null;
  }
}
