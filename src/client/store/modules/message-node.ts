import type { SSEFrame } from '@/shared/types/events';
import type { RunStatus } from '@/shared/types/agent';
import type { ReActStep, PendingMessageSnapshot } from '@/shared/types/render';
import type { Role } from '@/shared/types/entities';
import { makeAutoObservable } from 'mobx';

export type UIToolCall = {
  callId: string;
  toolName: string;
  toolArgs: Record<string, unknown>;
  status: 'pending' | 'completed' | 'failed';
  progress: unknown[];
  output?: unknown;
  error?: string;
  duration?: number;
  startedAt?: number;
  completedAt?: number;
};

export type AwaitingInputData = {
  message: string;
  schema: Record<string, unknown>;
};

/**
 * MessageNode — 客户端消息节点。
 *
 * 替换 MessageFSM + PendingMessage。
 * 无 FSM，MobX observable 属性变更直接驱动 UI。
 */
export class MessageNode {
  readonly id: string;
  readonly conversationId: string;
  readonly role: Role;
  readonly createdAt: Date;

  content = '';
  status: RunStatus = 'initialized';
  error?: string;
  cancelReason?: string;
  toolCalls: UIToolCall[] = [];
  thoughts: string[] = [];
  steps: ReActStep[] = [];
  contextUsage?: { used: number; total: number };
  private _awaitingInputData: AwaitingInputData | null = null;

  constructor(data: {
    id: string;
    conversationId: string;
    role: Role;
    createdAt: Date;
    content?: string;
    status?: RunStatus;
    steps?: ReActStep[] | null;
  }) {
    this.id = data.id;
    this.conversationId = data.conversationId;
    this.role = data.role;
    this.createdAt = data.createdAt;

    // Historical messages: initialize from projected value objects
    if (data.status && data.status !== 'initialized') {
      this.content = data.content ?? '';
      this.status = data.status;
      this.steps = data.steps ?? [];
      // Derive toolCalls and thoughts from steps for UI compatibility
      this.toolCalls = this.stepsToToolCalls(this.steps);
      this.thoughts = this.stepsToThoughts(this.steps);
    }

    makeAutoObservable(this);
  }

  // ════════════════════════════════════════
  // 事件处理（替代 FSM + PendingMessage）
  // ════════════════════════════════════════

  handleFrame(frame: SSEFrame): void {
    if (this.isTerminal) return;

    switch (frame.type) {
      case 'start':
        this.status = 'running';
        break;

      case 'text_chunk':
        this.content += frame.content;
        if (this.status === 'initialized') this.status = 'running';
        break;

      case 'thought':
        this.thoughts.push(frame.content);
        if (this.status === 'initialized') this.status = 'running';
        break;

      case 'tool_call':
        this.toolCalls.push({
          callId: frame.callId,
          toolName: frame.toolName,
          toolArgs: frame.toolArgs,
          status: 'pending',
          progress: [],
        });
        if (this.status === 'initialized') this.status = 'running';
        break;

      case 'tool_progress': {
        const tc = this.toolCalls.find(t => t.callId === frame.callId);
        if (tc) tc.progress.push(frame.data);
        if (this.status === 'initialized') this.status = 'running';

        // Check for awaiting_input (including nested agent_event)
        this.extractAwaitingInput(frame);
        break;
      }

      case 'tool_result': {
        const tc = this.toolCalls.find(t => t.callId === frame.callId);
        if (tc) {
          tc.status = 'completed';
          tc.output = frame.output;
        }
        break;
      }

      case 'tool_error': {
        const tc = this.toolCalls.find(t => t.callId === frame.callId);
        if (tc) {
          tc.status = 'failed';
          tc.error = frame.error;
        }
        break;
      }

      case 'final':
        this.status = 'completed';
        break;

      case 'cancelled':
        this.status = 'cancelled';
        this.cancelReason = frame.reason;
        break;

      case 'error':
        this.status = 'failed';
        this.error = frame.error;
        break;

      case 'context_usage':
        this.contextUsage = { used: frame.used, total: frame.total };
        break;
    }
  }

  /**
   * 从 PendingMessage snapshot 恢复状态（SSE 断线重连）。
   */
  applySnapshot(snapshot: PendingMessageSnapshot): void {
    this.content = snapshot.content;
    this.status = snapshot.status as RunStatus;
    this.steps = snapshot.steps;
    this.toolCalls = this.stepsToToolCalls(this.steps);
    this.thoughts = this.stepsToThoughts(this.steps);
  }

  // ════════════════════════════════════════
  // 派生 UI 状态
  // ════════════════════════════════════════

  get isStreaming(): boolean {
    return this.status === 'running' && this.content.length > 0;
  }

  get hasPendingTools(): boolean {
    return this.toolCalls.some(tc => tc.status === 'pending');
  }

  get isTerminal(): boolean {
    return (
      this.status === 'completed' ||
      this.status === 'failed' ||
      this.status === 'cancelled'
    );
  }

  get isThinking(): boolean {
    return this.status === 'running' && !this.content && !this.hasPendingTools;
  }

  get hasContent(): boolean {
    return this.content.length > 0;
  }

  get shouldExpandDetails(): boolean {
    return (
      !this.isTerminal &&
      (this.toolCalls.length > 0 || this.thoughts.length > 0)
    );
  }

  get isAwaitingInput(): boolean {
    return !this.isTerminal && this._awaitingInputData !== null;
  }

  get awaitingInput(): AwaitingInputData | null {
    return this.isAwaitingInput ? this._awaitingInputData : null;
  }

  get isInitialized(): boolean {
    return this.status === 'initialized';
  }

  // ── 内部 ──

  private stepsToToolCalls(steps: ReActStep[]): UIToolCall[] {
    return steps
      .filter(s => s.action)
      .map(s => ({
        callId: s.action!.callId,
        toolName: s.action!.toolName,
        toolArgs: s.action!.toolArgs,
        status: 'completed' as const,
        progress: [],
        output: s.observation,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
      }));
  }

  private stepsToThoughts(steps: ReActStep[]): string[] {
    return steps.map(s => s.thought);
  }

  private extractAwaitingInput(frame: SSEFrame): void {
    if (frame.type !== 'tool_progress') return;

    const data = frame.data as
      | {
          status?: string;
          schema?: Record<string, unknown>;
          message?: string;
          event?: { type: string; data?: unknown };
        }
      | undefined;

    if (data?.status === 'agent_event' && data.event) {
      const nested = this.doExtractAwaitingInput(data.event);
      if (nested) {
        this._awaitingInputData = nested;
        return;
      }
    }

    if (data?.status === 'awaiting_input' && data.schema) {
      this._awaitingInputData = {
        message: data.message ?? 'Please provide input',
        schema: data.schema,
      };
    }
  }

  private doExtractAwaitingInput(event: unknown): AwaitingInputData | null {
    const e = event as {
      type: string;
      data?: {
        status?: string;
        schema?: Record<string, unknown>;
        message?: string;
        event?: unknown;
      };
    };
    if (e.type !== 'tool_progress') return null;

    if (e.data?.status === 'awaiting_input' && e.data.schema) {
      return {
        message: e.data.message ?? 'Please provide input',
        schema: e.data.schema,
      };
    }

    if (e.data?.status === 'agent_event' && e.data.event) {
      return this.doExtractAwaitingInput(e.data.event);
    }

    return null;
  }
}
