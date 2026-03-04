import { AgentEvent } from '@/shared/types';
import type { Message } from '@/shared/types/entities';
import { generateId } from '@/shared/utils';

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
    return generateId('tc');
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
      callId: this.currentCallId,
      toolName,
      data,
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  agentToolResultEvent(toolName: string, output: unknown): AgentEvent {
    const event: AgentEvent = {
      type: 'tool_result',
      callId: this.currentCallId,
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
      callId: this.currentCallId,
      toolName,
      error,
      seq: this.nextSeq(),
      at: Date.now(),
    };
    this.pushEvent(event);
    this.popCallId();
    return event;
  }

  abort(reason: string): void {
    this.controller.abort(new Error(reason));
    this.setContent(reason);
  }
}
