import type { ReActStep, PendingMessageSnapshot } from '@/shared/types/render';

/**
 * AgentRun 运行事件的统一视图。
 * 省略 enrich 字段 (runId/seq/at)，只保留 PendingMessage 关心的字段。
 */
export interface RunEvent {
  type: string;
  content?: string;
  callId?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  output?: unknown;
  error?: string;
  reason?: string;
  at: number;
}

/**
 * PendingMessage — Conversation 聚合根内部实体。
 *
 * 职责：累积一条待定消息的 content 和 steps (ReActStep[])。
 * 通过 handleEvent() 消费 AgentRun 发布的事件来构建自身状态。
 *
 * - ChatAgent 场景：steps 为空，只累积 content
 * - ReActAgent 场景：逐步构建 ReActStep (thought + action + observation)
 */
export class PendingMessage {
  readonly messageId: string;
  private content = '';
  private steps: ReActStep[] = [];
  private currentStep: ReActStep | null = null;
  private terminated = false;
  private terminalStatus?: 'completed' | 'failed' | 'cancelled';

  constructor(messageId: string) {
    this.messageId = messageId;
  }

  handleEvent(event: RunEvent): void {
    if (this.terminated) return;

    switch (event.type) {
      case 'thought':
        if (!this.currentStep) {
          this.currentStep = {
            thought: event.content ?? '',
            startedAt: event.at,
          };
        } else {
          this.currentStep.thought += event.content ?? '';
        }
        break;

      case 'tool_call':
        if (this.currentStep) {
          this.currentStep.action = {
            callId: event.callId!,
            toolName: event.toolName!,
            toolArgs: event.toolArgs ?? {},
          };
        }
        break;

      case 'tool_result':
        if (this.currentStep) {
          this.currentStep.observation =
            typeof event.output === 'string'
              ? event.output
              : JSON.stringify(event.output);
          this.finalizeCurrentStep(event.at);
        }
        break;

      case 'tool_error':
        if (this.currentStep) {
          this.currentStep.observation = `Error: ${event.error}`;
          this.finalizeCurrentStep(event.at);
        }
        break;

      case 'text_chunk':
        this.content += event.content ?? '';
        break;

      case 'final':
        if (this.currentStep) this.finalizeCurrentStep(event.at);
        this.terminated = true;
        this.terminalStatus = 'completed';
        break;

      case 'error':
        if (this.currentStep) this.finalizeCurrentStep(event.at);
        this.terminated = true;
        this.terminalStatus = 'failed';
        break;

      case 'cancelled':
        if (this.currentStep) this.finalizeCurrentStep(event.at);
        this.terminated = true;
        this.terminalStatus = 'cancelled';
        break;
    }
  }

  private finalizeCurrentStep(at: number): void {
    if (this.currentStep) {
      this.currentStep.completedAt = at;
      this.steps.push(this.currentStep);
      this.currentStep = null;
    }
  }

  toSnapshot(): PendingMessageSnapshot {
    return {
      messageId: this.messageId,
      content: this.content,
      steps: [...this.steps],
      status: this.terminalStatus ?? 'running',
    };
  }
}
