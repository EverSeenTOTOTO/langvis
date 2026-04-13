import type { Logger } from '@/server/utils/logger';
import { AgentEvent, ToolConfig, type ToolCallTimeline } from '@/shared/types';
import { ExecutionContext } from '../ExecutionContext';

export abstract class Tool<I = unknown, O = unknown> {
  abstract readonly id: string;
  abstract readonly config: ToolConfig;

  protected abstract readonly logger: Logger;

  abstract call(
    input: I,
    ctx: ExecutionContext,
  ): AsyncGenerator<AgentEvent, O, void>;

  /**
   * Generate a one-line summary from a tool call timeline entry.
   * Called by memory to enrich historical messages with tool context.
   */
  summarize(timeline: ToolCallTimeline): string {
    const argsHint = this.summarizeArgs(timeline.toolArgs);
    if (timeline.status === 'error') {
      return `调用${timeline.toolName}${argsHint}: 失败 - ${timeline.error}`;
    }
    const outputHint = this.summarizeOutput(timeline.output);
    return `调用${timeline.toolName}${argsHint}: ${outputHint}`;
  }

  /** Override to highlight key input arguments. Default: empty. */
  summarizeArgs(_args: Record<string, unknown>): string {
    return '';
  }

  /** Override to highlight key output data. Default: "完成". */
  summarizeOutput(_output: unknown): string {
    return '完成';
  }
}

export type ToolConstructor = new (...args: any[]) => Tool;
