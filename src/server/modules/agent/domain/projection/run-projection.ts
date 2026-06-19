import type { ReActStep } from '@/shared/types/render';
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
}

export function projectRun(events: readonly EnrichedEvent[]): RunView {
  let content = '';
  const steps: ReActStep[] = [];
  let currentStep: ReActStep | null = null;

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
        if (currentStep) {
          currentStep.action = {
            callId: event.callId!,
            toolName: event.toolName!,
            toolArgs: event.toolArgs ?? {},
          };
        }
        break;

      case 'tool_result':
        if (currentStep) {
          currentStep.observation =
            typeof event.output === 'string'
              ? event.output
              : JSON.stringify(event.output);
          finalizeCurrentStep(event.at);
        }
        break;

      case 'tool_error':
        if (currentStep) {
          currentStep.observation = `Error: ${event.error}`;
          finalizeCurrentStep(event.at);
        }
        break;

      case 'text_chunk':
        content += event.content ?? '';
        break;

      case 'tool_progress':
        // Ephemeral — not part of the steps projection.
        break;

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
        // Lifecycle / usage markers — no content accumulation.
        break;
    }
  }

  return { content, steps, status };
}
