import { inject } from 'tsyringe';
import { eventHandler } from '@/server/decorator/handler';
import type { DomainEvent } from '@/server/libs/ddd';
import { SessionManager } from '../service/session-manager';
import { MESSAGE_REPOSITORY } from '../../conversation.di-tokens';
import type { MessageRepositoryPort } from '../../domain/port/message.repository.port';
import { AGENT_RUN_REPOSITORY } from '@/server/modules/agent/agent.di-tokens';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import { projectRun } from '@/server/modules/agent/domain/projection/run-projection';
import { RunCompleted } from '../../contracts';
import type { RunCompletedPayload } from '../../contracts';

@eventHandler(RunCompleted)
export class CompleteTurnHandler {
  constructor(
    @inject(SessionManager)
    private sessionManager: SessionManager,
    @inject(MESSAGE_REPOSITORY)
    private messageRepo: MessageRepositoryPort,
    @inject(AGENT_RUN_REPOSITORY)
    private agentRunRepo: AgentRunRepositoryPort,
  ) {}

  async handle(event: DomainEvent<string, RunCompletedPayload>): Promise<void> {
    const { conversationId, messageId, agentRunId } = event.payload;

    // 从内存中的活跃 run 投影出最终状态（事实源 → 读模型）
    const run = this.sessionManager.getActiveRun(conversationId, messageId);
    if (run) {
      const view = projectRun(run.eventStream);

      // Agent BC: 持久化事件流 + status
      await this.agentRunRepo.update(agentRunId, {
        events: [...run.eventStream],
        status: view.status,
        completedAt: new Date(),
      });

      // Conversation BC: Message 存最终文本。
      // cancelled/failed 时 view.content 可能是空（尚未生成任何 text_chunk），
      // 用终止原因作内容，避免渲染出空白气泡；completed 用生成的文本。
      let content = view.content;
      if (view.status === 'cancelled' || view.status === 'failed') {
        const terminal = [...run.eventStream]
          .reverse()
          .find(e => e.type === 'cancelled' || e.type === 'error');
        if (terminal?.type === 'cancelled') content = terminal.reason;
        else if (terminal?.type === 'error') content = terminal.error;
      }
      await this.messageRepo.update(messageId, { content });
    }

    this.sessionManager.finalizeRun(conversationId, messageId);
  }
}
