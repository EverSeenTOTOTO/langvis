import type { ReActStep, AwaitingInputProjection } from '@/shared/types/render';
import type { EnrichedEvent } from '@/shared/types/events';

/**
 * projectRun — 纯投影函数。
 *
 * 把 AgentRun 的事实流 (EnrichedEvent[]) fold 成读模型 RunView。
 * 这是 PendingMessage 的归宿：读侧（API 响应、持久化、SSE 断线重连）
 * 统一调用它，单一投影来源，保证实时流与历史读回一致。
 *
 * 无状态、无副作用、可在任何时候对完整或部分事件流重算。
 */
export interface RunView {
  content: string;
  steps: ReActStep[];
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  /** Non-null while the run is blocked on an ask_user / awaiting_input prompt
   * (the last awaiting tool_progress not yet resolved by a tool_result). */
  awaitingInput: AwaitingInputProjection | null;
}

export function projectRun(events: readonly EnrichedEvent[]): RunView {
  let content = '';
  const steps: ReActStep[] = [];
  let currentStep: ReActStep | null = null;
  let awaitingInput: AwaitingInputProjection | null = null;

  let status: RunView['status'] = 'running';

  const finalizeCurrentStep = (at: number): void => {
    if (currentStep) {
      currentStep.completedAt = at;
      steps.push(currentStep);
      currentStep = null;
    }
  };

  for (const event of events) {
    switch (event.type) {
      case 'thought':
        if (!currentStep) {
          currentStep = { thought: event.content ?? '', startedAt: event.at };
        } else {
          currentStep.thought += event.content ?? '';
        }
        break;

      case 'tool_call':
        // thought is optional in the flat ReAct format ({ thought?, tool, input }),
        // so a tool_call may arrive without a preceding thought — start a step
        // here so the action/observation isn't dropped from the projection.
        if (!currentStep) {
          currentStep = { thought: '', startedAt: event.at };
        }
        currentStep.action = {
          callId: event.callId!,
          toolName: event.toolName!,
          toolArgs: event.toolArgs ?? {},
        };
        break;

      case 'tool_result':
        // A result resolves any pending awaiting_input prompt.
        awaitingInput = null;
        if (currentStep) {
          currentStep.observation =
            typeof event.output === 'string'
              ? event.output
              : JSON.stringify(event.output);
          finalizeCurrentStep(event.at);
        }
        break;

      case 'tool_error':
        awaitingInput = null;
        if (currentStep) {
          currentStep.observation = `Error: ${event.error}`;
          finalizeCurrentStep(event.at);
        }
        break;

      case 'text_chunk':
        content += event.content ?? '';
        break;

      case 'tool_progress': {
        // Ephemeral — not part of the steps projection, but an awaiting_input
        // prompt marks the run as blocked until the user submits (used to
        // restore the confirmation form on reconnect).
        const data = event.data as
          | {
              status?: string;
              message?: string;
              schema?: Record<string, unknown>;
            }
          | undefined;
        if (data?.status === 'awaiting_input' && data.schema) {
          awaitingInput = {
            callId: event.callId!,
            message: data.message ?? 'Please provide input',
            schema: data.schema,
          };
        }
        break;
      }

      case 'final':
        finalizeCurrentStep(event.at);
        status = 'completed';
        break;

      case 'error':
        finalizeCurrentStep(event.at);
        status = 'failed';
        break;

      case 'cancelled':
        finalizeCurrentStep(event.at);
        status = 'cancelled';
        break;

      case 'start':
      case 'context_usage':
      case 'process_summary':
        // Lifecycle / usage / compaction markers — no content accumulation.
        break;
    }
  }

  // An open step (e.g. a tool_call whose result hasn't arrived — including one
  // blocked on awaiting_input) is in-flight; include it so a running run
  // exposes its pending tool call in the projection (snapshot / historical read).
  if (currentStep) {
    steps.push(currentStep);
  }

  return { content, steps, status, awaitingInput };
}
