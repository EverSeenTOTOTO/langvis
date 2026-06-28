import { inject } from 'tsyringe';
import { eventHandler } from '@/server/decorator/handler';
import { createDomainEvent, EventBus } from '@/server/libs/ddd';
import type { DomainEvent } from '@/server/libs/ddd';
import { SessionManager } from '../service/session-manager';
import { MESSAGE_REPOSITORY } from '../../conversation.di-tokens';
import type { MessageRepositoryPort } from '../../domain/port/message.repository.port';
import { AGENT_RUN_REPOSITORY } from '@/server/modules/agent/agent.di-tokens';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import { projectRun } from '../service/run-projection';
import { HistoryCompactionRequested } from '@/server/modules/memory';
import Logger from '@/server/utils/logger';
import { RunCompleted } from '../../contracts';
import type { RunCompletedPayload } from '../../contracts';

@eventHandler(RunCompleted)
export class CompleteTurnHandler {
  private readonly logger = Logger.child({ source: 'CompleteTurnHandler' });

  constructor(
    @inject(SessionManager)
    private sessionManager: SessionManager,
    @inject(MESSAGE_REPOSITORY)
    private messageRepo: MessageRepositoryPort,
    @inject(AGENT_RUN_REPOSITORY)
    private agentRunRepo: AgentRunRepositoryPort,
    @inject(EventBus)
    private eventBus: EventBus,
  ) {}

  async handle(event: DomainEvent<string, RunCompletedPayload>): Promise<void> {
    const { conversationId, messageId, agentRunId } = event.payload;

    // 从会话缓冲的事件流投影最终状态（事实源 → 读模型）。run 持久化由 agent 的 executor 拥有。
    const events = this.sessionManager.getRunEvents(conversationId, messageId);
    if (events && events.length > 0) {
      const view = projectRun(events);

      // Conversation BC: Message 存最终文本。
      // cancelled/failed 时 view.content 可能是空（尚未生成任何 text_chunk），
      // 用终止原因作内容，避免渲染出空白气泡；completed 用生成的文本。
      let content = view.content;
      if (view.status === 'cancelled' || view.status === 'failed') {
        const terminal = [...events]
          .reverse()
          .find(e => e.type === 'cancelled' || e.type === 'error');
        if (terminal?.type === 'cancelled') content = terminal.reason;
        else if (terminal?.type === 'error') content = terminal.error;
      }

      // 过程摘要（loop-exit fold 产物）：附到 agent message 的 meta（用户不可见，下轮 LLM 可见）。
      const psEvent = [...events]
        .reverse()
        .find(e => e.type === 'process_summary');
      const processSummary =
        psEvent?.type === 'process_summary' ? psEvent.summary : null;

      // 语音回复（response_user 的 tts 产物）：附到 meta.audio，前端在回复底部渲染音频，重载后仍在。
      const audioEvent = [...events].reverse().find(e => e.type === 'audio');
      const audio =
        audioEvent?.type === 'audio'
          ? { filePath: audioEvent.filePath, voice: audioEvent.voice }
          : null;

      const meta: Record<string, unknown> = {};
      if (processSummary) meta.processSummary = processSummary;
      if (audio) meta.audio = audio;

      await this.messageRepo.update(
        messageId,
        Object.keys(meta).length > 0 ? { content, meta } : { content },
      );

      // 历史层压缩：有效历史超阈时折叠成新的压缩摘要 C（hidden Message），供后续 turn 复用。
      // 改事件往返——conv 只 gather 历史+配置发请求，memory 计算、conv 的 HistoryCompactedHandler 持久化。
      await this.requestCompaction(conversationId, agentRunId);
    }

    this.sessionManager.finalizeRun(conversationId, messageId);
  }

  private async requestCompaction(
    conversationId: string,
    agentRunId: string,
  ): Promise<void> {
    // gather 历史 + run 配置，发 HistoryCompactionRequested；memory 监听计算（repo-free）后
    // 发 HistoryCompacted，由 HistoryCompactedHandler 持久化 compact 消息。
    // run 配置（contextSize/runtimeConfig）读自 agent_runs 行（只读；持久化由 agent 拥有）。
    try {
      const run = await this.agentRunRepo.findById(agentRunId);
      if (!run?.config) return;

      const messages =
        await this.messageRepo.findByConversationId(conversationId);
      this.eventBus.dispatch(
        HistoryCompactionRequested,
        createDomainEvent(HistoryCompactionRequested, conversationId, {
          conversationId,
          messages,
          contextSize: run.config.contextSize,
          runtimeConfig: run.config.runtimeConfig,
        }),
      );
    } catch (err) {
      // gather/分发失败不影响 turn 完成。
      this.logger.warn(
        `Requesting history compaction failed: ${(err as Error)?.message ?? err}`,
      );
    }
  }
}
