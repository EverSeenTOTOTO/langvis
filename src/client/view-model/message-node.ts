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

// `progress` is an untyped `unknown[]` on the wire; each tool defines its
// element shape. These extractors narrow it once for all renderers.

/** stdout/stderr chunk emitted by streaming tools (Bash). */
export type ToolStreamChunk = { type: 'stdout' | 'stderr'; text: string };

/** A raw child-run record emitted by call_subagents in the progress stream. */
export type SubagentChild = {
  childRunId?: string;
  query?: string;
  brief?: string;
  event?: { type?: string };
};

/** A child run aggregated from its progress records (one per childRunId). */
export type SubagentChildState = {
  runId: string;
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  query?: string;
  brief?: string;
};

const isStreamChunk = (c: unknown): c is ToolStreamChunk =>
  !!c &&
  typeof c === 'object' &&
  ((c as ToolStreamChunk).type === 'stdout' ||
    (c as ToolStreamChunk).type === 'stderr') &&
  typeof (c as ToolStreamChunk).text === 'string' &&
  (c as ToolStreamChunk).text.length > 0;

// Non-empty stdout/stderr chunks from a tool's progress stream (Bash etc.), in order.
export const streamChunks = (progress: unknown[]): ToolStreamChunk[] =>
  progress.filter(isStreamChunk);

// Last stdout/stderr line, or '' if none — a compact "what's happening now" hint while a tool runs.
export const lastStreamLine = (progress: unknown[]): string => {
  const chunks = streamChunks(progress);
  return chunks.length
    ? chunks[chunks.length - 1].text.replace(/\n+$/, '')
    : '';
};

// Merge call_subagents progress into one state per child run, deriving status from the terminal event.
export const aggregateSubagentChildren = (
  progress: unknown[],
): SubagentChildState[] => {
  const map = new Map<string, SubagentChildState>();
  const ensure = (id: string): SubagentChildState => {
    let c = map.get(id);
    if (!c) {
      c = { runId: id, status: 'running' };
      map.set(id, c);
    }
    return c;
  };
  for (const p of progress) {
    if (!p || typeof p !== 'object') continue;
    const d = p as SubagentChild;
    if (!d.childRunId) continue;
    const c = ensure(d.childRunId);
    if (d.brief !== undefined) c.brief = d.brief;
    if (d.query !== undefined) c.query = d.query;
    const ev = d.event?.type;
    if (ev === 'final') c.status = 'completed';
    else if (ev === 'error') c.status = 'failed';
    else if (ev === 'cancelled') c.status = 'cancelled';
  }
  return [...map.values()];
};

export type AwaitingInputData = {
  // React key for HumanInputForm — a new ask_user in one turn remounts it to re-check status.
  runId: string;
  callId: string;
  message: string;
  schema: Record<string, unknown>;
};

// Item in the agent's process timeline — how thoughts and tool actions are displayed.
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

// MessageNode — 纯渲染者：状态由 run_view 帧整体替换，实时/重连/历史共用 applyView 入口；MobX 属性驱动 UI。
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

  // ═══ 状态应用（实时 run_view / 重连 / 历史共用）═══

  // 整体替换为服务端投影的 RunView：覆盖 content/steps/status/audio/awaitingInput
  // 并重派生 toolCalls/timeline；终态后忽略迟到的帧（同步竞态防回退）。
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

  // ═══ 派生 UI 状态 ═══

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
