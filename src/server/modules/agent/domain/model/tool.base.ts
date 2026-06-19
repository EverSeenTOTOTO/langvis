import type { Logger } from '@/server/utils/logger';
import type { ToolConfig, ToolCallTimeline } from '@/shared/types';
import type { ToolCall } from './tool-call.entity';
import type { EnrichedEvent } from '@/shared/types/events';

export abstract class Tool<O = unknown> {
  abstract readonly id: string;
  abstract readonly config: ToolConfig;

  protected abstract readonly logger: Logger;

  abstract call(toolCall: ToolCall): AsyncGenerator<EnrichedEvent, O, void>;

  summarize(timeline: ToolCallTimeline): string {
    const argsHint = this.summarizeArgs(timeline.toolArgs);
    if (timeline.status === 'error') {
      return `调用${timeline.toolName}${argsHint}: 失败 - ${timeline.error}`;
    }
    const outputHint = this.summarizeOutput(timeline.output);
    return `调用${timeline.toolName}${argsHint}: ${outputHint}`;
  }

  summarizeArgs(_args: Record<string, unknown>): string {
    return '';
  }

  summarizeOutput(_output: unknown): string {
    return '完成';
  }

  async dispose(): Promise<void> {}
}

export type ToolConstructor = new (...args: any[]) => Tool;
