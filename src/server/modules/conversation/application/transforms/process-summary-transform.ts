import { inject } from 'tsyringe';
import type { StreamFrame, EnrichedEvent } from '@/shared/types/events';
import type { LlmMessage } from '@/shared/types/entities';
import { MESSAGE_REPOSITORY } from '@/server/modules/conversation/conversation.di-tokens';
import type { MessageRepositoryPort } from '@/server/modules/conversation/domain/port/message.repository.port';
import type {
  ConversationContext,
  ConvPhase,
  ConvTransform,
  RunCtx,
} from '@/server/modules/conversation/domain/model/conv-transform';
import { fold, PROCESS_SUMMARY_PROMPT } from '@/server/libs/compaction';
import Logger from '@/server/utils/logger';
import { convTransform } from './registry';

/**
 * turn-end 折叠本 run 的事件轨迹为过程摘要（仅记工作，不复述最终答案），写入 assistant 消息的
 * `meta.summary`，供下一轮 turn-start 的 projectToLlmMessages 透传为 seed thought。
 *
 * 后台化：跑在 RunCompleted 订阅里，终态帧（flushRunView）已在其之前发出，用户不感知折叠延迟。
 * 屏障：turn-end 维护屏障保证下一次 turn-start 在压缩完成后才 append userMessage。
 */
@convTransform
export class ProcessSummaryTransform implements ConvTransform {
  readonly id = 'process-summary';
  readonly phase: ConvPhase = 'turn-end';
  private readonly logger = Logger.child({ source: 'ProcessSummaryTransform' });

  constructor(
    @inject(MESSAGE_REPOSITORY)
    private readonly messageRepo: MessageRepositoryPort,
  ) {}

  async *apply(
    ctx: ConversationContext,
    runCtx?: RunCtx,
  ): AsyncGenerator<StreamFrame | void> {
    if (!runCtx) return;
    const compaction = ctx.runtimeConfig.loop;
    if (!compaction) return;

    const events = ctx.getRunEvents(runCtx.messageId);
    if (!events || events.length === 0) return;

    const trajectory = eventsToTrajectory(events);
    if (trajectory.length <= 1) {
      this.logger.debug(`trivial turn, skipped (msg ${runCtx.messageId})`);
      return;
    }

    try {
      const summary = await fold({
        messages: trajectory,
        windowSize: compaction.windowSize,
        signal: new AbortController().signal,
        prompt: PROCESS_SUMMARY_PROMPT,
        modelId: compaction.compactModelId ?? ctx.runtimeConfig.model?.modelId,
      });
      if (!summary) return;

      const existing = await this.fetchMeta(ctx, runCtx.messageId);
      await this.messageRepo.update(runCtx.messageId, {
        meta: { ...existing, summary },
      });
      this.logger.info(
        `folded process summary (msg ${runCtx.messageId}): ${trajectory.length} trajectory msgs`,
      );
    } catch (err) {
      this.logger.warn(
        `Process summary failed: ${(err as Error)?.message ?? err}`,
      );
    }
  }

  /** 取该消息现有 meta（合并写、不覆盖既有键）；消息不存在则空对象。 */
  private async fetchMeta(
    ctx: ConversationContext,
    messageId: string,
  ): Promise<Record<string, unknown>> {
    const msg = ctx.messages.toArray().find(m => m.id === messageId);
    return { ...(msg?.meta ?? {}) };
  }
}

/**
 * 把 run 事件流折叠为 ReAct 轨迹（LlmMessage[]），供 process-summary fold 消费。
 * thought→assistant；tool_call+args→assistant（Action）；tool_result/tool_error→user（Observation）。
 * 线性 reduce（events 已按到达序）；跳过 start/loop_usage/final/audio 等非动作事实。
 */
export function eventsToTrajectory(
  events: readonly EnrichedEvent[],
): LlmMessage[] {
  const out: LlmMessage[] = [];
  for (const e of events) {
    switch (e.type) {
      case 'thought':
        out.push({ role: 'assistant', content: e.content ?? '' });
        break;
      case 'tool_call':
        out.push({
          role: 'assistant',
          content: `Action: ${e.toolName}\n${JSON.stringify(e.toolArgs ?? {})}`,
        });
        break;
      case 'tool_result': {
        const observation =
          typeof e.output === 'string' ? e.output : JSON.stringify(e.output);
        out.push({ role: 'user', content: `Observation: ${observation}` });
        break;
      }
      case 'tool_error':
        out.push({ role: 'user', content: `Observation: Error: ${e.error}` });
        break;
      default:
        break;
    }
  }
  return out;
}
