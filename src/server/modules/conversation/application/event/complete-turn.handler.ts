import { inject } from 'tsyringe';
import { eventHandler } from '@/server/decorator/handler';
import type { DomainEvent } from '@/server/libs/ddd';
import { SessionManager } from '../service/session-manager';
import { HistoryCompactionService } from '../service/history-compaction.service';
import { MESSAGE_REPOSITORY } from '../../conversation.di-tokens';
import type { MessageRepositoryPort } from '../../domain/port/message.repository.port';
import { projectRun } from '../service/run-projection';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';
import type { SSEFrame } from '@/shared/types/events';
import { RunCompleted } from '../../contracts';
import type { RunCompletedPayload } from '../../contracts';
import Logger from '@/server/utils/logger';

@eventHandler(RunCompleted)
export class CompleteTurnHandler {
  private readonly logger = Logger.child({ source: 'CompleteTurnHandler' });

  constructor(
    @inject(SessionManager)
    private sessionManager: SessionManager,
    @inject(MESSAGE_REPOSITORY)
    private messageRepo: MessageRepositoryPort,
    @inject(HistoryCompactionService)
    private readonly compaction: HistoryCompactionService,
  ) {}

  async handle(event: DomainEvent<string, RunCompletedPayload>): Promise<void> {
    const { conversationId, messageId } = event.payload;

    // 从会话缓冲的事件流投影最终状态（事实源 → 读模型）。run 持久化由 agent 的 executor 拥有。
    const events = this.sessionManager.getRunEvents(conversationId, messageId);
    if (events && events.length > 0) {
      const view = projectRun(events);

      // Conversation BC: Message 存最终文本。
      // cancelled/failed 时 view.content 可能是空，用终止原因作内容避免空白气泡；completed 用生成文本。
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

      // 语音回复（response_user 的 tts 产物）：附到 meta.audio。
      const audioEvent = [...events].reverse().find(e => e.type === 'audio');
      const audio =
        audioEvent?.type === 'audio'
          ? { filePath: audioEvent.filePath, voice: audioEvent.voice }
          : null;

      const meta: Record<string, unknown> = {};
      if (processSummary) meta.processSummary = processSummary;
      if (audio) meta.audio = audio;

      const updated = await this.messageRepo.update(
        messageId,
        Object.keys(meta).length > 0 ? { content, meta } : { content },
      );

      // post-turn 记忆维护：把本轮 assistant 消息追加到会话记忆，再驱动历史压缩（在会话成员历史上 fold）。
      // 压缩产物由 conv 落盘为 compact 消息并 append 回记忆。await 以保序。
      await this.runPostTurnMemory(conversationId, updated ?? undefined);
    }

    this.sessionManager.finalizeRun(conversationId, messageId);
  }

  private async runPostTurnMemory(
    conversationId: string,
    assistantMessage: Message | undefined,
  ): Promise<void> {
    try {
      const memory = this.sessionManager.getMemory(conversationId);
      if (assistantMessage) {
        memory.append(assistantMessage);
      }
      const cfg = this.sessionManager.getMemoryConfig(conversationId);
      const result = await this.compaction.compact({
        messages: memory.getMessages(),
        contextSize: cfg.contextSize,
        runtimeConfig: cfg.runtimeConfig,
        signal: new AbortController().signal,
      });
      if (result) {
        const [compactMessage] = await this.messageRepo.batchCreate(
          conversationId,
          [
            {
              role: Role.USER,
              content: result.content,
              meta: { kind: 'compact', startRef: result.startRef },
              createdAt: new Date(),
            },
          ],
        );
        memory.append(compactMessage);
        this.sendUsage(conversationId, result.usage.used, result.usage.total);
      } else {
        const usage = memory.getContextUsage();
        this.sendUsage(conversationId, usage.used, usage.total);
      }
    } catch (err) {
      this.logger.warn(
        `Post-turn memory maintenance failed: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  private sendUsage(conversationId: string, used: number, total: number): void {
    this.sessionManager.sendFrame(conversationId, {
      type: 'conversation_usage',
      used,
      total,
    } as SSEFrame);
  }
}
