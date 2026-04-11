import { ToolIds } from '@/shared/constants';
import type { LlmMessage } from '@/shared/types/entities';
import { AgentEvent } from '@/shared/types';
import { generateId } from '@/shared/utils';
import { container } from 'tsyringe';
import type LlmCallTool from './tool/LlmCall';

export type CallLlmOptions = {
  modelId?: string;
  messages?: LlmMessage[];
  temperature?: number;
  topP?: number;
  stop?: string[];
  response_format?: { type: string };
};

export class ExecutionContext {
  public get signal(): AbortSignal {
    return this.controller.signal;
  }

  private seqCounter = 0;
  private callIdStack: string[] = [];
  private onPushContextUsage?: (messages: LlmMessage[]) => Promise<void>;

  constructor(
    private readonly controller: AbortController,
    private readonly messageId: string = '',
  ) {}

  setOnPushContextUsage(
    callback: (messages: LlmMessage[]) => Promise<void>,
  ): void {
    this.onPushContextUsage = callback;
  }

  async pushContextUsage(messages: LlmMessage[]): Promise<void> {
    await this.onPushContextUsage?.(messages);
  }

  private nextSeq(): number {
    return ++this.seqCounter;
  }

  private nextCallId(): string {
    const id = generateId('tc');
    return this.messageId ? `${this.messageId}::${id}` : id;
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

  abort(reason: string): void {
    this.controller.abort(new Error(reason));
  }

  // === Event factories (return event objects, no persistence) ===

  agentStartEvent(): AgentEvent {
    return {
      type: 'start',
      messageId: this.messageId,
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  agentThoughtEvent(content: string): AgentEvent {
    return {
      type: 'thought',
      messageId: this.messageId,
      content,
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  agentStreamEvent(content: string): AgentEvent {
    return {
      type: 'stream',
      messageId: this.messageId,
      content,
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  agentFinalEvent(): AgentEvent {
    return {
      type: 'final',
      messageId: this.messageId,
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  agentCancelledEvent(reason: string): AgentEvent {
    return {
      type: 'cancelled',
      messageId: this.messageId,
      reason,
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  agentErrorEvent(error: string): AgentEvent {
    return {
      type: 'error',
      messageId: this.messageId,
      error,
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  agentToolCallEvent(
    toolName: string,
    toolArgs: Record<string, unknown>,
  ): AgentEvent {
    const callId = this.pushCallId();
    return {
      type: 'tool_call',
      messageId: this.messageId,
      callId,
      toolName,
      toolArgs,
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  agentToolProgressEvent(toolName: string, data: unknown): AgentEvent {
    return {
      type: 'tool_progress',
      messageId: this.messageId,
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
      messageId: this.messageId,
      callId: this.currentCallId,
      toolName,
      output,
      seq: this.nextSeq(),
      at: Date.now(),
    };
    this.popCallId();
    return event;
  }

  agentToolErrorEvent(toolName: string, error: string): AgentEvent {
    const event: AgentEvent = {
      type: 'tool_error',
      messageId: this.messageId,
      callId: this.currentCallId,
      toolName,
      error,
      seq: this.nextSeq(),
      at: Date.now(),
    };
    this.popCallId();
    return event;
  }

  // === LlmCall util ===

  async *callLlm(
    options: CallLlmOptions,
    ignore: boolean = true,
  ): AsyncGenerator<AgentEvent, string, void> {
    const llmCallTool = container.resolve<LlmCallTool>(ToolIds.LLM_CALL);
    let content = '';

    for await (const event of llmCallTool.call(options, this)) {
      if (event.type === 'tool_progress' && typeof event.data === 'string') {
        content += event.data;
        if (!ignore) {
          yield this.agentStreamEvent(event.data);
        }
      }
    }

    return content;
  }
}
