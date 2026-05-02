import { memory } from '@/server/decorator/core';
import { MemoryIds } from '@/shared/constants';
import { buildToolTimeline, type ToolCallTimeline } from '@/shared/types/tool';
import { Message, Role } from '@/shared/entities/Message';
import { container } from 'tsyringe';
import SlideWindowMemory from '../SlideWindow';
import { Tool } from '../../tool';

@memory(MemoryIds.REACT)
export default class ReActMemory extends SlideWindowMemory {
  /**
   * Generate tool summaries from the current assistant message's events
   * and store them in meta.toolSummaries before persist.
   */
  override async completeTurn(currentMessage?: Message): Promise<void> {
    if (!currentMessage || currentMessage.role !== Role.ASSIST) return;

    const events = currentMessage.meta?.events;
    if (!events?.length) return;

    const timeline = buildToolTimeline(events);
    const summaries = this.generateToolSummaries(timeline);

    if (summaries.length > 0) {
      if (!currentMessage.meta) currentMessage.meta = {};
      currentMessage.meta.toolSummaries = summaries;
    }
  }

  private generateToolSummaries(timeline: ToolCallTimeline[]): string[] {
    return timeline.map(entry => {
      try {
        const tool = container.resolve<Tool>(entry.toolName);
        return tool.summarize(entry);
      } catch {
        // Fallback if tool resolution fails
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
