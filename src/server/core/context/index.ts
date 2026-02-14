import { AgentEvent, ToolEvent } from '@/shared/types';

export class ExecutionContext {
  constructor(
    public readonly traceId: string,
    public readonly signal: AbortSignal,
  ) {}

  agentEvent(event: AgentEvent): AgentEvent {
    return event;
  }

  toolEvent(event: ToolEvent): ToolEvent {
    return event;
  }

  adaptToolEvent(event: ToolEvent): AgentEvent {
    if (event.type === 'progress') {
      return {
        type: 'tool_progress',
        toolName: event.toolName,
        data: event.data,
      };
    }
    return {
      type: 'tool_result',
      toolName: event.toolName,
      output: event.output,
      isError: event.isError,
    };
  }

  static create(traceId: string, signal: AbortSignal): ExecutionContext {
    return new ExecutionContext(traceId, signal);
  }
}
