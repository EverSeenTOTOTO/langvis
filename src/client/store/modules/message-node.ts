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
  /** callId of the tool_progress frame — used as React key so a new ask_user
   * in the same turn remounts HumanInputForm (re-running its status check),
   * instead of reusing the stale submitted=true state of the prior prompt. */
  callId: string;
  message: string;
  schema: Record<string, unknown>;
};

/**
 * Ordered item in the agent's process timeline — the single source of truth
 * for how thoughts and tool actions are displayed.
 *
 * Arrival order is recorded here (not in separate `thoughts`/`toolCalls`
 * arrays) so a thought renders next to the tool action that followed it,
 * instead of all thoughts being dumped after all tools. Tool items reference
 * the live `UIToolCall` by callId; the underlying entry is updated in place
 * as progress/result/error frames arrive, without appending a new item.
 */
export type TimelineItem =
  | { kind: 'thought'; key: string; content: string }
  | { kind: 'tool'; key: string; callId: string };

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
  timeline: TimelineItem[] = [];
  steps: ReActStep[] = [];
  audio: { filePath: string; voice?: string } | null = null;
  private _awaitingInputData: AwaitingInputData | null = null;

  constructor(data: {
    id: string;
    conversationId: string;
    role: Role;
    createdAt: Date;
    content?: string;
    status?: RunStatus;
    steps?: ReActStep[] | null;
    audio?: { filePath: string; voice?: string } | null;
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
      this.audio = data.audio ?? null;
      // Derive toolCalls + ordered timeline from steps
      this.toolCalls = this.stepsToToolCalls(this.steps);
      this.timeline = this.stepsToTimeline(this.steps);
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
        this.timeline.push({
          kind: 'thought',
          key: `th_${frame.seq}`,
          content: frame.content,
        });
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
        this.timeline.push({
          kind: 'tool',
          key: frame.callId,
          callId: frame.callId,
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
        // 终态原因写入 content，使其在气泡中渲染（cancelReason 字段本身无渲染消费），
        // 与服务端 CompleteTurnHandler 落库的 content 保持一致，避免取消后空气泡。
        this.content = frame.reason;
        break;

      case 'error':
        this.status = 'failed';
        this.error = frame.error;
        this.content = frame.error;
        break;

      case 'audio':
        this.audio = { filePath: frame.filePath, voice: frame.voice };
        break;
    }
  }

  /**
   * 从 PendingMessage snapshot 恢复状态（SSE 断线重连）。
   */
  applySnapshot(snapshot: PendingMessageSnapshot): void {
    this.content = snapshot.content;
    this.status = (snapshot.status as RunStatus) ?? 'running';
    this.steps = snapshot.steps;
    this.toolCalls = this.stepsToToolCalls(this.steps);
    this.timeline = this.stepsToTimeline(this.steps);
    // Restore an in-flight ask_user prompt so the confirmation form survives
    // a reconnect while the run is blocked awaiting input.
    this._awaitingInputData = snapshot.awaitingInput ?? null;
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
    return !this.isTerminal && this.timeline.length > 0;
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
        // A step without completedAt is still in flight (e.g. a tool awaiting
        // input) — show it as pending so the reconnect view matches the live one.
        status: s.completedAt ? 'completed' : 'pending',
        progress: [],
        output: s.observation,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
      }));
  }

  private stepsToTimeline(steps: ReActStep[]): TimelineItem[] {
    // Each step is (thought?) → (action?). Drop empty thoughts so a
    // thoughtless step (tool_call with no preceding thought) contributes only
    // its tool — matches the live path, which appends a thought item only when
    // a thought frame actually arrives.
    const items: TimelineItem[] = [];
    steps.forEach((s, index) => {
      if (s.thought.length > 0) {
        items.push({
          kind: 'thought',
          key: `th_${index}`,
          content: s.thought,
        });
      }
      if (s.action) {
        items.push({
          kind: 'tool',
          key: s.action.callId,
          callId: s.action.callId,
        });
      }
    });
    return items;
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
        this._awaitingInputData = { ...nested, callId: frame.callId };
        return;
      }
    }

    if (data?.status === 'awaiting_input' && data.schema) {
      this._awaitingInputData = {
        callId: frame.callId,
        message: data.message ?? 'Please provide input',
        schema: data.schema,
      };
    }
  }

  private doExtractAwaitingInput(
    event: unknown,
  ): Omit<AwaitingInputData, 'callId'> | null {
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
