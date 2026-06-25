import { inject } from 'tsyringe';
import { eventHandler } from '@/server/decorator/handler';
import type { DomainEvent } from '@/server/libs/ddd';
import { SessionManager } from '../service/session-manager';
import { MESSAGE_REPOSITORY } from '../../conversation.di-tokens';
import type { MessageRepositoryPort } from '../../domain/port/message.repository.port';
import { AGENT_RUN_REPOSITORY } from '@/server/modules/agent/agent.di-tokens';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';
import type { AgentRun } from '@/server/modules/agent/domain/model/agent-run.entity';
import { projectRun } from '@/server/modules/agent/domain/projection/run-projection';
import { HistoryCompactionService } from '@/server/modules/memory/application/service/history-compaction.service';
import { COMPACTION_SUMMARY_KIND } from '@/server/modules/memory/domain/service/compaction-summary.util';
import { readCompactionConfig } from '@/server/modules/memory/domain/service/compaction-config';
import { Role } from '@/shared/entities/Message';
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
    @inject(HistoryCompactionService)
    private historyCompaction: HistoryCompactionService,
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

      // 过程摘要（loop-exit fold 产物）：附到 agent message 的 meta（用户不可见，下轮 LLM 可见）。
      const psEvent = [...run.eventStream]
        .reverse()
        .find(e => e.type === 'process_summary');
      const processSummary =
        psEvent?.type === 'process_summary' ? psEvent.summary : null;

      // 语音回复（response_user 的 tts 产物）：附到 meta.audio，前端在回复底部渲染音频，重载后仍在。
      const audioEvent = [...run.eventStream]
        .reverse()
        .find(e => e.type === 'audio');
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

      // 历史层压缩：有效历史超阈时，折叠成新的压缩摘要 C（hidden Message），供后续 turn 复用。
      await this.compactHistory(conversationId, run);
    }

    this.sessionManager.finalizeRun(conversationId, messageId);
  }

  private async compactHistory(
    conversationId: string,
    run: AgentRun,
  ): Promise<void> {
    const runtimeConfig = run.config.runtimeConfig as {
      model?: { modelId?: string };
    };
    const modelId = runtimeConfig.model?.modelId;
    if (!modelId) return;

    const cc = readCompactionConfig(run.config.runtimeConfig);
    // 收敛单一 ReAct agent 后，历史压缩仅由 compaction.enabled 开关控制。
    if (!cc.enabled) return;

    const controller = new AbortController();
    try {
      const history =
        await this.messageRepo.findByConversationId(conversationId);
      const result = await this.historyCompaction.compact({
        messages: history,
        modelId,
        contextSize: run.config.contextSize,
        threshold: cc.threshold,
        windowSize: cc.windowSize,
        signal: controller.signal,
      });
      if (!result) return;

      await this.messageRepo.batchCreate(conversationId, [
        {
          role: Role.USER,
          content: result.content,
          meta: {
            hidden: true,
            kind: COMPACTION_SUMMARY_KIND,
            startRef: result.startRef,
          },
          createdAt: new Date(),
        },
      ]);
    } catch (err) {
      // 压缩失败不影响 turn 完成流程。
      this.logger.warn(
        `History compaction failed: ${(err as Error)?.message ?? err}`,
      );
    }
  }
}
