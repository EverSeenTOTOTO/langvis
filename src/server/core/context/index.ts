import { AgentEvent, ToolEvent } from '@/shared/types';
import type { Message } from '@/shared/types/entities';

export class ExecutionContext {
  public get signal(): AbortSignal {
    return this.controller.signal;
  }

  public get traceId(): string {
    return this.message.id;
  }

  private seqCounter = 0;
  private callIdStack: string[] = [];

  constructor(
    public message: Message,
    private readonly controller: AbortController,
  ) {}

  private nextSeq(): number {
    return ++this.seqCounter;
  }

  private nextCallId(): string {
    return `tc_${crypto.randomUUID().slice(0, 8)}`;
  }

  get currentCallId(): string {
    return this.callIdStack.at(-1)!;
  }

  private pushCallId(): string {
    const callId = this.nextCallId();
    this.callIdStack.push(callId);
    return callId;
  }

  private popCallId(): void {
    this.callIdStack.pop();
  }

  // === Content management ===

  appendContent(text: string): void {
    this.message.content += text;
  }

  setContent(content: string): void {
    this.message.content = content;
  }

  // === Events management ===

  private getEvents(): AgentEvent[] {
    if (!this.message.meta) {
      this.message.meta = {};
    }
    if (!this.message.meta.events) {
      this.message.meta.events = [];
    }
    return this.message.meta.events;
  }

  private pushEvent(event: AgentEvent): void {
    if (event.type !== 'stream') {
      this.getEvents().push(event);
    }
  }

  // === AgentEvent helpers ===

  agentStartEvent(): AgentEvent {
    const event: AgentEvent = {
      type: 'start',
      seq: this.nextSeq(),
      at: Date.now(),
    };
    this.pushEvent(event);
    return event;
  }

  agentThoughtEvent(content: string): AgentEvent {
    const event: AgentEvent = {
      type: 'thought',
      content,
      seq: this.nextSeq(),
      at: Date.now(),
    };
    this.pushEvent(event);
    return event;
  }

  agentStreamEvent(content: string): AgentEvent {
    this.appendContent(content);
    return { type: 'stream', content, seq: this.nextSeq(), at: Date.now() };
  }

  agentFinalEvent(): AgentEvent {
    const event: AgentEvent = {
      type: 'final',
      seq: this.nextSeq(),
      at: Date.now(),
    };
    this.pushEvent(event);
    return event;
  }

  agentCancelledEvent(reason: string): AgentEvent {
    const event: AgentEvent = {
      type: 'cancelled',
      reason,
      seq: this.nextSeq(),
      at: Date.now(),
    };
    this.pushEvent(event);
    return event;
  }

  agentErrorEvent(error: string): AgentEvent {
    const event: AgentEvent = {
      type: 'error',
      error,
      seq: this.nextSeq(),
      at: Date.now(),
    };
    this.pushEvent(event);
    this.setContent(error);
    return event;
  }

  agentToolCallEvent(
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): AgentEvent {
    const callId = this.pushCallId();

    const event: AgentEvent = {
      type: 'tool_call',
      callId,
      toolName,
      toolArgs,
      seq: this.nextSeq(),
      at: Date.now(),
    };
    this.pushEvent(event);
    return event;
  }

  agentToolProgressEvent(toolName: string, data: unknown): AgentEvent {
    return {
      type: 'tool_progress',
      callId: this.ensureCallId(),
      toolName,
      data,
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  agentToolResultEvent(toolName: string, output: unknown): AgentEvent {
    const event: AgentEvent = {
      type: 'tool_result',
      callId: this.ensureCallId(),
      toolName,
      output,
      seq: this.nextSeq(),
      at: Date.now(),
    };
    this.pushEvent(event);
    this.popCallId();
    return event;
  }

  agentToolErrorEvent(toolName: string, error: string): AgentEvent {
    const event: AgentEvent = {
      type: 'tool_error',
      callId: this.ensureCallId(),
      toolName,
      error,
      seq: this.nextSeq(),
      at: Date.now(),
    };
    this.pushEvent(event);
    this.popCallId();
    return event;
  }

  // === ToolEvent helpers ===

  private ensureCallId(): string {
    if (this.callIdStack.length === 0) {
      this.pushCallId();
    }
    return this.callIdStack.at(-1)!;
  }

  toolProgressEvent(toolName: string, data: unknown): ToolEvent {
    return {
      type: 'progress',
      callId: this.ensureCallId(),
      toolName,
      data,
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  toolResultEvent(toolName: string, output: unknown): ToolEvent {
    return {
      type: 'result',
      callId: this.ensureCallId(),
      toolName,
      output,
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  toolErrorEvent(toolName: string, error: string): ToolEvent {
    return {
      type: 'error',
      callId: this.ensureCallId(),
      toolName,
      error,
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  // === Adaptation ===

  adaptToolEvent(event: ToolEvent): AgentEvent {
    const seq = this.nextSeq();

    if (event.type === 'progress') {
      return {
        type: 'tool_progress',
        callId: event.callId,
        toolName: event.toolName,
        data: event.data,
        seq,
        at: event.at,
      };
    }
    if (event.type === 'error') {
      const adapted: AgentEvent = {
        type: 'tool_error',
        callId: event.callId,
        toolName: event.toolName,
        error: event.error,
        seq,
        at: event.at,
      };
      this.pushEvent(adapted);
      this.popCallId();
      return adapted;
    }
    const adapted: AgentEvent = {
      type: 'tool_result',
      callId: event.callId,
      toolName: event.toolName,
      output: event.output,
      seq,
      at: event.at,
    };
    this.pushEvent(adapted);
    this.popCallId();
    return adapted;
  }

  abort(reason: string): void {
    this.controller.abort(new Error(reason));
  }
}
