import { Inject } from '@nestjs/common';
import { QueryHandler } from '@nestjs/cqrs';
import { AGENT_RUN_REPOSITORY } from '@/server/modules/agent/agent.di-tokens';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import { SessionManager } from '../service/session-manager';
import { RunViewCache } from '../service/run-view-cache';
import { projectRun, type RunViewResult } from '../service/run-projection';
import { GetRunViewQuery } from '../../contracts';

// conv 读模型查询：live 子 run 从父 run 的 session 缓冲派生（每次重 fold，事件在变）；
// 历史 run 走自身持久化事件行（终态投影过 RunViewCache 复用）。
@QueryHandler(GetRunViewQuery)
export class GetRunViewHandler {
  constructor(
    @Inject(SessionManager) private readonly sessionManager: SessionManager,
    @Inject(AGENT_RUN_REPOSITORY)
    private readonly agentRunRepo: AgentRunRepositoryPort,
    @Inject(RunViewCache) private readonly viewCache: RunViewCache,
  ) {}

  async execute(query: GetRunViewQuery): Promise<RunViewResult | null> {
    // Live：从活跃父 run 的缓冲提取该子 run 的事件。
    const live = this.sessionManager.getChildRunEvents(query.runId);
    if (live && live.length > 0) {
      const view = projectRun(live);
      return { runId: query.runId, status: view.status, view };
    }

    // Persisted：该 run 自身的事件行（父或子均在 finalization 时 flush）。
    const run = await this.agentRunRepo.findById(query.runId);
    if (!run) return null;
    const view = this.viewCache.project(run);
    return { runId: run.id, status: run.status, view };
  }
}
