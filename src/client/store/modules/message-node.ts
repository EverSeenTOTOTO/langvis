import type { RunStatus } from '@/shared/types/agent';
import type { ReActStep, AwaitingInputProjection } from '@/shared/types/render';
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
  /** callId of the awaiting tool_progress — used as React key so a new ask_user
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
 * Tool items reference a `UIToolCall` by callId; toolCalls/timeline are derived
 * from the projected `steps` on every view (live, reconnect, historical alike).
 */
export type TimelineItem =
  | { kind: 'thought'; key: string; content: string }
  | { kind: 'tool'; key: string; callId: string };

/** ReActStep[] → UIToolCall[]。 */
export function stepsToToolCalls(steps: ReActStep[]): UIToolCall[] {
  return steps
    .filter(s => s.action)
    .map(s => ({
      callId: s.action!.callId,
      toolName: s.action!.toolName,
      toolArgs: s.action!.toolArgs,
      status: s.action!.status,
      error: s.action!.error,
      progress: s.action!.progress ?? [],
      output: s.observation,
      startedAt: s.startedAt,
      completedAt: s.completedAt,
    }));
}

/** ReActStep[] → TimelineItem[]（thought/action 绑定、按到达序）。 */
export function stepsToTimeline(steps: ReActStep[]): TimelineItem[] {
  // Each step is (thought?) → (action?). Drop empty thoughts so a thoughtless
  // step (tool_call with no preceding thought) contributes only its tool.
  const items: TimelineItem[] = [];
  steps.forEach((s, index) => {
    if (s.thought.length > 0) {
      items.push({ kind: 'thought', key: `th_${index}`, content: s.thought });
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

/**
 * MessageNode — 客户端消息节点。
 *
 * 纯渲染者：状态由服务端投影（run_view 帧）整体替换，客户端不再自行 reduce
 * 原始事件。实时流、断线重连、历史读回共用同一条 applyView 入口与同一 `steps`
 * 形状——消除「实时对象 / 回放字符串」式的双路径分叉。MobX observable 属性变更
 * 直接驱动 UI。
 */
export class MessageNode {
  readonly id: string;
  readonly conversationId: string;
  readonly role: Role;
  readonly createdAt: Date;

  content = '';
  status: RunStatus = 'initialized';
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

    // Historical messages: hydrate from the server's projected fields via the
    // same entry point the live stream uses.
    if (data.status && data.status !== 'initialized') {
      this.applyView({
        content: data.content ?? '',
        status: data.status,
        steps: data.steps ?? [],
        audio: data.audio ?? null,
        awaitingInput: null,
      });
    }

    makeAutoObservable(this);
  }

  // ════════════════════════════════════════
  // 状态应用（实时 run_view / 重连 / 历史共用）
  // ════════════════════════════════════════

  /**
   * 整体替换为服务端投影的 RunView。每帧覆盖 content/steps/status/audio/
   * awaitingInput，并重新派生 toolCalls/timeline。终态后忽略迟到的投影帧
   * （合并定时器可能与终态同步帧竞态——避免把已终态的节点回退）。
   */
  applyView(view: {
    content: string;
    steps: ReActStep[];
    status: RunStatus;
    awaitingInput: AwaitingInputProjection | null;
    audio: { filePath: string; voice?: string } | null;
  }): void {
    if (this.isTerminal) return;
    this.content = view.content;
    this.status = view.status;
    this.steps = view.steps;
    this.audio = view.audio;
    this._awaitingInputData = view.awaitingInput;
    this.toolCalls = stepsToToolCalls(this.steps);
    this.timeline = stepsToTimeline(this.steps);
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
}
