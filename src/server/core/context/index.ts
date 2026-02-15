import { AgentEvent, StepEvent, ToolEvent } from '@/shared/types';

export class ExecutionContext {
  private _steps: StepEvent[] = [];

  public get signal(): AbortSignal {
    return this.controller.signal;
  }

  public get steps(): StepEvent[] {
    return this._steps;
  }

  constructor(
    public readonly traceId: string,
    private readonly controller: AbortController,
  ) {}

  // === AgentEvent helpers ===

  agentThoughtEvent(content: string): AgentEvent {
    this._steps.push({ type: 'thought', content });
    return { type: 'thought', content, meta: { steps: [...this._steps] } };
  }

  agentStreamEvent(content: string): AgentEvent {
    return { type: 'stream', content };
  }

  agentFinalEvent(): AgentEvent {
    return { type: 'final' };
  }

  agentErrorEvent(error: string): AgentEvent {
    return { type: 'error', error };
  }

  agentToolCallEvent(toolName: string, toolArgs: string): AgentEvent {
    this._steps.push({ type: 'tool', name: toolName, args: toolArgs });
    return {
      type: 'tool_call',
      toolName,
      toolArgs,
      meta: { steps: [...this._steps] },
    };
  }

  agentToolProgressEvent(toolName: string, data: unknown): AgentEvent {
    return { type: 'tool_progress', toolName, data };
  }

  agentToolResultEvent(toolName: string, output: string): AgentEvent {
    const tool = this._steps.findLast(
      s => s.type === 'tool' && s.name === toolName && !s.output && !s.error,
    );
    if (tool && tool.type === 'tool') {
      tool.output = output;
    }
    return {
      type: 'tool_result',
      toolName,
      output,
      meta: { steps: [...this._steps] },
    };
  }

  agentToolErrorEvent(toolName: string, error: string): AgentEvent {
    const tool = this._steps.findLast(
      s => s.type === 'tool' && s.name === toolName && !s.output && !s.error,
    );
    if (tool && tool.type === 'tool') {
      tool.error = error;
    }
    return {
      type: 'tool_error',
      toolName,
      error,
      meta: { steps: [...this._steps] },
    };
  }

  // === ToolEvent helpers ===

  toolProgressEvent(toolName: string, data: unknown): ToolEvent {
    return { type: 'progress', toolName, data };
  }

  toolResultEvent(toolName: string, output: string): ToolEvent {
    return { type: 'result', toolName, output };
  }

  toolErrorEvent(toolName: string, error: string): ToolEvent {
    return { type: 'error', toolName, error };
  }

  // === Adaptation ===

  adaptToolEvent(event: ToolEvent): AgentEvent {
    if (event.type === 'progress') {
      return {
        type: 'tool_progress',
        toolName: event.toolName,
        data: event.data,
      };
    }
    if (event.type === 'error') {
      return this.agentToolErrorEvent(event.toolName, event.error);
    }
    return this.agentToolResultEvent(event.toolName, event.output);
  }

  abort(reason?: string): void {
    this.controller.abort(new Error(reason ?? 'Aborted'));
  }

  static create(
    traceId: string,
    controller: AbortController,
  ): ExecutionContext {
    return new ExecutionContext(traceId, controller);
  }
}
