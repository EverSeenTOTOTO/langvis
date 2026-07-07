import type { ReActStep, AwaitingInputProjection } from '@/shared/types/render';
import type { EnrichedEvent } from '@/shared/types/events';

/**
 * 纯投影函数：把 AgentRun 的事实流 fold 成读模型 RunView，供 SSE 回放 / 回回完成 / 历史读回共用，
 * 单一投影来源保证实时流与历史读回一致。无状态、无副作用、可对任意子流重算。
 *
 * 归属：这是 agent run 的投影，归 agent 模块（agentRun 应脱离对话体系独立运行）。
 * conv 侧（chat.service / get-messages / conversation-session）按需从这里导入。
 */
export interface RunView {
  content: string;
  steps: ReActStep[];
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  /** Non-null while the run is blocked on an ask_user / awaiting_input prompt
   * (the last awaiting tool_progress not yet resolved by a tool_result). */
  awaitingInput: AwaitingInputProjection | null;
  processSummary: string | null;
  audio: { filePath: string; voice?: string } | null;
}

/** GetRunView 查询的 DTO——任意 run（含子 agent）的投影 + 权威状态。前后端共享。 */
export interface RunViewResult {
  runId: string;
  status: string;
  view: RunView;
}

export function projectRun(events: readonly EnrichedEvent[]): RunView {
  let content = '';
  const steps: ReActStep[] = [];
  let currentStep: ReActStep | null = null;
  let awaitingInput: AwaitingInputProjection | null = null;
  let processSummary: string | null = null;
  let audio: { filePath: string; voice?: string } | null = null;

  let status: RunView['status'] = 'running';
  let terminalReason: string | null = null;

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
        terminalReason = event.error;
        break;

      case 'cancelled':
        finalizeCurrentStep(event.at);
        status = 'cancelled';
        terminalReason = event.reason;
        break;

      case 'process_summary':
        processSummary = event.summary;
        break;

      case 'audio':
        audio = { filePath: event.filePath, voice: event.voice };
        break;

      case 'start':
      case 'loop_usage':
        // Lifecycle / telemetry markers — no content accumulation.
        break;
    }
  }

  // 终态（failed/cancelled）用终止原因覆盖内容，避免空白气泡——投影单一来源，
  // 实时快照与持久化文案由此一致。
  if (
    (status === 'failed' || status === 'cancelled') &&
    terminalReason !== null
  ) {
    content = terminalReason;
  }

  // An open step (e.g. a tool_call whose result hasn't arrived — including one
  // blocked on awaiting_input) is in-flight; include it so a running run
  // exposes its pending tool call in the projection (snapshot / historical read).
  if (currentStep) {
    steps.push(currentStep);
  }

  return { content, steps, status, awaitingInput, processSummary, audio };
}
