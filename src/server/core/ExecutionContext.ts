import { ToolIds } from '@/shared/constants';
import { AgentEvent } from '@/shared/types';
import { generateId } from '@/shared/utils';
import type { ChatCompletionCreateParams } from 'openai/resources/chat/completions';
import { container } from 'tsyringe';
import type LlmCallTool from './tool/LlmCall';

export class ExecutionContext {
  public get signal(): AbortSignal {
    return this.controller.signal;
  }

  private seqCounter = 0;
  private callIdStack: string[] = [];

  constructor(private readonly controller: AbortController) {}

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

  abort(reason: string): void {
    this.controller.abort(new Error(reason));
  }

  // === Event factories (return event objects, no persistence) ===

  agentStartEvent(): AgentEvent {
    return {
      type: 'start',
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  agentThoughtEvent(content: string): AgentEvent {
    return {
      type: 'thought',
      content,
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  agentStreamEvent(content: string): AgentEvent {
    return {
      type: 'stream',
      content,
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  agentFinalEvent(): AgentEvent {
    return {
      type: 'final',
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  agentCancelledEvent(reason: string): AgentEvent {
    return {
      type: 'cancelled',
      reason,
      seq: this.nextSeq(),
      at: Date.now(),
    };
  }

  agentErrorEvent(error: string): AgentEvent {
    return {
      type: 'error',
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
    this.popCallId();
    return event;
  }

  // === LlmCall util ===

  async *callLlm(
    options: Partial<ChatCompletionCreateParams>,
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
