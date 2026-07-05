import { inject } from 'tsyringe';
import { queryHandler } from '@/server/decorator/handler';
import { MESSAGE_REPOSITORY } from '../../conversation.di-tokens';
import type { MessageRepositoryPort } from '../../domain/port/message.repository.port';
import { AGENT_RUN_REPOSITORY } from '@/server/modules/agent/agent.di-tokens';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';
import { projectRun } from '../service/run-projection';
import { GetMessagesQuery } from '../../contracts';

/**
 * GetMessagesHandler — 读模型组装：取会话消息 + 跨 BC 取 agent_runs，
 * 对 assistant 消息用 projectRun(run.events) 派生 steps/status（events 唯一事实，
 * 不物化派生结果），content 取 msg.content 兜底 view.content。
 */
@queryHandler(GetMessagesQuery)
export class GetMessagesHandler {
  constructor(
    @inject(MESSAGE_REPOSITORY) private messageRepo: MessageRepositoryPort,
    @inject(AGENT_RUN_REPOSITORY)
    private agentRunRepo: AgentRunRepositoryPort,
  ) {}

  async execute(query: GetMessagesQuery): Promise<Message[]> {
    const messages = await this.messageRepo.findByConversationId(
      query.conversationId,
    );

    const agentRunIds = messages
      .filter(m => m.role === Role.ASSIST && m.agentRunId)
      .map(m => m.agentRunId!);
    const agentRuns =
      agentRunIds.length > 0
        ? await this.agentRunRepo.findByIds(agentRunIds)
        : [];
    const runMap = new Map(agentRuns.map(r => [r.id, r]));

    return messages.map(msg => {
      if (msg.role === Role.ASSIST && msg.agentRunId) {
        const run = runMap.get(msg.agentRunId);
        if (run) {
          const view = projectRun(run.events ?? []);
          return {
            ...msg,
            content: msg.content || view.content,
            steps: view.steps,
            status: run.status,
          };
        }
        return { ...msg, steps: null, status: null };
      }
      return msg;
    });
  }
}
