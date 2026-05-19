import { AgentEvent } from '@/shared/types';
import { memory } from '@/server/decorator/core';
import { MemoryIds } from '@/shared/constants';
import { buildToolTimeline, type ToolCallTimeline } from '@/shared/types/tool';
import { Message, Role } from '@/shared/entities/Message';
import type { LlmMessage } from '@/shared/types/entities';
import { container } from 'tsyringe';
import { TraceContext } from '../../TraceContext';
import SlideWindowMemory from '../SlideWindow';
import { Tool } from '../../tool';

@memory(MemoryIds.REACT)
export default class ReActMemory extends SlideWindowMemory {
  override async *postTurn(
    currentMessage?: Message,
  ): AsyncGenerator<AgentEvent, void, void> {
    if (!currentMessage || currentMessage.role !== Role.ASSIST) return;

    const events = currentMessage.events;
    if (!events?.length) return;

    const timeline = buildToolTimeline(events);
    const summaries = this.generateToolSummaries(timeline);

    if (summaries.length > 0) {
      if (!currentMessage.meta) currentMessage.meta = {};
      currentMessage.meta.toolSummaries = summaries;
    }

    const messages = [...(await this.summarize()), currentMessage];
    yield* this.yieldContextUsage(messages, currentMessage.id);
  }

  override async *postStep(
    _stepIndex: number,
    iterMessages: LlmMessage[],
  ): AsyncGenerator<AgentEvent, void, void> {
    const messageId = TraceContext.getOrFail().messageId ?? '';
    yield* this.yieldContextUsage(iterMessages, messageId);
  }

  private generateToolSummaries(timeline: ToolCallTimeline[]): string[] {
    return timeline.map(entry => {
      try {
        const tool = container.resolve<Tool>(entry.toolName);
        return tool.summarize(entry);
      } catch {
        if (entry.status === 'error') {
          return `调用${entry.toolName}: 失败 - ${entry.error}`;
        }
        return `调用${entry.toolName}: 完成`;
      }
    });
  }

  override async summarize(): Promise<Message[]> {
    const messages = await super.summarize();

    return messages.map(msg => {
      if (msg.role !== Role.ASSIST) return msg;

      const summaries = msg.meta?.toolSummaries as string[] | undefined;
      if (!summaries?.length) return msg;

      const summaryBlock = summaries.map(s => `> ${s}`).join('\n');
      return {
        ...msg,
        content: `${summaryBlock}\n\n${msg.content}`,
      };
    });
  }
}
