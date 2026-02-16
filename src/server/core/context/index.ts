import { AgentEvent, ToolEvent } from '@/shared/types';
import type { Message } from '@/shared/types/entities';

export class ExecutionContext {
  content: string = '';
  events: AgentEvent[] = [];

  public get signal(): AbortSignal {
    return this.controller.signal;
  }

  public get traceId(): string {
    return this.message.id;
  }

  constructor(
    public readonly message: Message,
    private readonly controller: AbortController,
  ) {}

  // === Content management ===

  appendContent(text: string): void {
    this.content += text;
  }

  setContent(content: string): void {
    this.content = content;
  }

  // === Events management ===

  private pushEvent(event: AgentEvent): void {
    if (event.type !== 'stream') {
      this.events.push(event);
    }
  }

  // === AgentEvent helpers ===

  agentStartEvent(): AgentEvent {
    const event: AgentEvent = { type: 'start', at: Date.now() };
    this.pushEvent(event);
    return event;
  }

  agentThoughtEvent(content: string): AgentEvent {
    const event: AgentEvent = { type: 'thought', content, at: Date.now() };
    this.pushEvent(event);
    return event;
  }

  agentStreamEvent(content: string): AgentEvent {
    this.appendContent(content);
    return { type: 'stream', content, at: Date.now() };
  }

  agentFinalEvent(): AgentEvent {
    const event: AgentEvent = { type: 'final', at: Date.now() };
    this.pushEvent(event);
    return event;
  }

  agentErrorEvent(error: string): AgentEvent {
    const event: AgentEvent = { type: 'error', error, at: Date.now() };
    this.pushEvent(event);
    return event;
  }

  agentToolCallEvent(toolName: string, toolArgs: string): AgentEvent {
    const event: AgentEvent = {
      type: 'tool_call',
      toolName,
      toolArgs,
      at: Date.now(),
    };
    this.pushEvent(event);
    return event;
  }

  agentToolProgressEvent(toolName: string, data: unknown): AgentEvent {
    return { type: 'tool_progress', toolName, data, at: Date.now() };
  }

  agentToolResultEvent(toolName: string, output: unknown): AgentEvent {
    const event: AgentEvent = {
      type: 'tool_result',
      toolName,
      output,
      at: Date.now(),
    };
    this.pushEvent(event);
    return event;
  }

  agentToolErrorEvent(toolName: string, error: string): AgentEvent {
    const event: AgentEvent = {
      type: 'tool_error',
      toolName,
      error,
      at: Date.now(),
    };
    this.pushEvent(event);
    return event;
  }

  // === ToolEvent helpers ===

  toolProgressEvent(toolName: string, data: unknown): ToolEvent {
    return { type: 'progress', toolName, data, at: Date.now() };
  }

  toolResultEvent(toolName: string, output: unknown): ToolEvent {
    return { type: 'result', toolName, output, at: Date.now() };
  }

  toolErrorEvent(toolName: string, error: string): ToolEvent {
    return { type: 'error', toolName, error, at: Date.now() };
  }

  // === Adaptation ===

  adaptToolEvent(event: ToolEvent): AgentEvent {
    if (event.type === 'progress') {
      return {
        type: 'tool_progress',
        toolName: event.toolName,
        data: event.data,
        at: event.at,
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
    message: Message,
    controller: AbortController,
  ): ExecutionContext {
    return new ExecutionContext(message, controller);
  }
}
