import { inject } from 'tsyringe';
import { queryHandler } from '@/server/decorator/handler';
import { AGENT_RUN_REPOSITORY } from '@/server/modules/agent/agent.di-tokens';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import { SessionManager } from '../service/session-manager';
import { projectRun, type RunViewResult } from '../service/run-projection';
import { GetRunViewQuery } from '../../contracts';

/**
 * GetRunViewHandler —— conv 的读模型查询（任意 run，含子 agent）。
 *
 * 子 run 的事件由 CallSubagents 转发进父 run（tool_progress { childRunId, event }），
 * 故 live 子 run 的详情从父 run 的 session 缓冲派生（不读 agent 的 executor）；
 * 历史子 run 走其自身的持久化事件行（executor 在 finalization 时 flush）。
 * 父 run 自身的详情走持久化行（它是顶层 run，有自己的行）。
 *
 * 归属：这是 conv 对 agent 事件的读模型投影 + 前端展示，agent 模块不感知 view。
 */
@queryHandler(GetRunViewQuery)
export class GetRunViewHandler {
  constructor(
    @inject(SessionManager) private readonly sessionManager: SessionManager,
    @inject(AGENT_RUN_REPOSITORY)
    private readonly agentRunRepo: AgentRunRepositoryPort,
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
    const view = projectRun(run.events ?? []);
    return { runId: run.id, status: run.status, view };
  }
}
