import { inject } from 'tsyringe';
import { eventHandler } from '@/server/decorator/handler';
import type { DomainEvent } from '@/server/libs/ddd';
import { SessionManager } from '../service/session-manager';
import { LLM_PORT } from '@/server/libs/ports/llm/llm.tokens';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
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
    @inject(LLM_PORT)
    private readonly llm: LlmPort,
  ) {}

  async handle(event: DomainEvent<string, RunCompletedPayload>): Promise<void> {
    const { conversationId, messageId } = event.payload;

    // 从会话缓冲的事件流投影最终状态（事实源 → 读模型）；run 持久化由 agent 的 executor 拥有。
    const events = this.sessionManager.getRunEvents(conversationId, messageId);
    if (events && events.length > 0) {
      const view = projectRun(events);

      // cancelled/failed 时 view.content 可能为空，用终止原因作内容避免空白气泡。
      let content = view.content;
      if (view.status === 'cancelled' || view.status === 'failed') {
        const terminal = [...events]
          .reverse()
          .find(e => e.type === 'cancelled' || e.type === 'error');
        if (terminal?.type === 'cancelled') content = terminal.reason;
        else if (terminal?.type === 'error') content = terminal.error;
      }

      // 过程摘要（loop-exit fold 产物）与语音回复附到 agent message 的 meta（用户不可见，下轮 LLM 可见）。
      const psEvent = [...events]
        .reverse()
        .find(e => e.type === 'process_summary');
      const processSummary =
        psEvent?.type === 'process_summary' ? psEvent.summary : null;

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

      // post-turn 记忆维护：追加本轮 assistant 消息并驱动历史压缩（在会话成员历史上 fold，
      // 产物落盘为 compact 消息并回填记忆）。await 以保序。
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
      const result = await memory.compact({
        llm: this.llm,
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
