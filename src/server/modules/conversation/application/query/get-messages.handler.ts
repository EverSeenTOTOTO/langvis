import { inject } from 'tsyringe';
import { queryHandler } from '@/server/decorator/handler';
import { MESSAGE_REPOSITORY } from '../../conversation.di-tokens';
import type { MessageRepositoryPort } from '../../domain/port/message.repository.port';
import { AGENT_RUN_REPOSITORY } from '@/server/modules/agent/agent.di-tokens';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';
import { RunViewCache } from '@/server/modules/conversation/application/service/run-view-cache';
import { GetMessagesQuery } from '../../contracts';

// 读模型组装：assistant 消息用 projectRun(run.events) 派生 steps/status/audio，不物化派生结果；
// 终态 run 投影经 RunViewCache 复用，避免每次读对话全量重 fold 历史事件。
@queryHandler(GetMessagesQuery)
export class GetMessagesHandler {
  constructor(
    @inject(MESSAGE_REPOSITORY) private messageRepo: MessageRepositoryPort,
    @inject(AGENT_RUN_REPOSITORY)
    private agentRunRepo: AgentRunRepositoryPort,
    @inject(RunViewCache) private viewCache: RunViewCache,
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
          const view = this.viewCache.project(run);
          return {
            ...msg,
            content: msg.content || view.content,
            steps: view.steps,
            status: run.status,
            audio: view.audio,
          };
        }
        return { ...msg, steps: null, status: null, audio: null };
      }
      return msg;
    });
  }
}
