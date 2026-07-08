import type { ReActStep, AwaitingInputProjection } from '@/shared/types/render';
import type { EnrichedEvent } from '@/shared/types/events';

/**
 * 纯投影函数：把 agent run 的事实流 fold 成读模型 RunView。conv 的读模型——
 * 实时 run_view 合并下发、回回完成持久化、历史读回共用此同一投影，保证实时流
 * 与历史读回一致。无状态、无副作用、可对任意子流重算。
 *
 * 归属：这是 conv 对 agent 事件流的读模型投影（agent 只存/外发 RunEvent，
 * 不感知 view）。agent 侧不引用本文件。
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

export function emptyRunView(): RunView {
  return {
    content: '',
    steps: [],
    status: 'running',
    awaitingInput: null,
    processSummary: null,
    audio: null,
  };
}

/**
 * The currently-open step — the one still accumulating thought / tool progress
 * / result. It is `steps[last]` without a `completedAt`; null once the last step
 * is finalized (or before any step exists). Deriving it from `completedAt` lets
 * the reducer be a pure fold over RunView with no extra cursor state, and makes
 * an in-flight step (e.g. a tool_call whose result hasn't arrived, or one blocked
 * on awaiting_input) appear in `steps` the instant it starts — so a running
 * run's snapshot exposes its pending tool.
 */
function openStep(view: RunView): ReActStep | null {
  const last = view.steps[view.steps.length - 1];
  return last && last.completedAt === undefined ? last : null;
}

function ensureStep(view: RunView, at: number): ReActStep {
  let step = openStep(view);
  if (!step) {
    step = { thought: '', startedAt: at };
    view.steps.push(step);
  }
  return step;
}

function finalizeOpenStep(view: RunView, at: number): void {
  const step = openStep(view);
  if (step) step.completedAt = at;
}

/**
 * Fold one event into the view (mutates and returns `view`). Stateless per call
 * beyond the passed accumulator — `projectRun` is `events.reduce` over this, and
 * ConversationSession folds one event at a time into a per-run view. Behaviour
 * is identical to the previous full-array fold for every prefix.
 */
export function applyEventToView(view: RunView, event: EnrichedEvent): RunView {
  switch (event.type) {
    case 'thought': {
      ensureStep(view, event.at).thought += event.content ?? '';
      break;
    }

    case 'tool_call': {
      // thought is optional in the flat ReAct format ({ thought?, tool, input }),
      // so a tool_call may arrive without a preceding thought — ensureStep opens
      // a new step here so the action/observation isn't dropped from the projection.
      const step = ensureStep(view, event.at);
      step.action = {
        callId: event.callId!,
        toolName: event.toolName!,
        toolArgs: event.toolArgs ?? {},
        status: 'pending',
      };
      break;
    }

    case 'tool_result':
      // A result resolves any pending awaiting_input prompt.
      view.awaitingInput = null;
      {
        const step = openStep(view);
        if (step?.action) {
          step.action.status = 'completed';
          step.observation =
            typeof event.output === 'string'
              ? event.output
              : JSON.stringify(event.output);
          step.completedAt = event.at;
        }
      }
      break;

    case 'tool_error':
      view.awaitingInput = null;
      {
        const step = openStep(view);
        if (step?.action) {
          step.action.status = 'failed';
          step.action.error = event.error;
          step.observation = `Error: ${event.error}`;
          step.completedAt = event.at;
        }
      }
      break;

    case 'text_chunk':
      // Terminal failure/cancellation overrides content (set on the terminal
      // event below); ignore any late chunks so the override sticks.
      if (view.status !== 'failed' && view.status !== 'cancelled') {
        view.content += event.content ?? '';
      }
      break;

    case 'tool_progress': {
      const data = event.data as
        | {
            status?: string;
            message?: string;
            schema?: Record<string, unknown>;
            childRunId?: unknown;
          }
        | undefined;
      if (data?.status === 'awaiting_input' && data.schema) {
        view.awaitingInput = {
          callId: event.callId!,
          message: data.message ?? 'Please provide input',
          schema: data.schema,
        };
      }
      // Retain ALL tool progress (call_subagents child blobs, Bash stdout/stderr
      // chunks, status messages, …) — the live renderers read these from the
      // projected view now, so nothing can be dropped here.
      const step = openStep(view);
      if (step?.action) (step.action.progress ??= []).push(event.data);
      break;
    }

    case 'final':
      finalizeOpenStep(view, event.at);
      view.status = 'completed';
      break;

    case 'error':
      finalizeOpenStep(view, event.at);
      view.status = 'failed';
      view.content = event.error;
      break;

    case 'cancelled':
      finalizeOpenStep(view, event.at);
      view.status = 'cancelled';
      view.content = event.reason;
      break;

    case 'process_summary':
      view.processSummary = event.summary;
      break;

    case 'audio':
      view.audio = { filePath: event.filePath, voice: event.voice };
      break;

    case 'start':
    case 'loop_usage':
      // Lifecycle / telemetry markers — no content accumulation.
      break;
  }
  return view;
}

export function projectRun(events: readonly EnrichedEvent[]): RunView {
  return events.reduce(applyEventToView, emptyRunView());
}

/**
 * 提取某子 run（call_subagents 的 child）的事件流——CallSubagents 把每个 child 事件
 * 以 tool_progress { childRunId, event } 转发进父 run；这里按 childRunId 过滤、解包。
 * 仅取带 `event` 的 per-event 块（跳过 { childRunId, brief, query } 的 started 块）。
 * 顺序保留（父按 child 事件到达序转发）。
 */
export function extractChildEvents(
  events: readonly EnrichedEvent[],
  childRunId: string,
): EnrichedEvent[] {
  const child: EnrichedEvent[] = [];
  for (const e of events) {
    if (e.type !== 'tool_progress') continue;
    const data = e.data as
      | { childRunId?: unknown; event?: EnrichedEvent }
      | undefined;
    if (data?.childRunId === childRunId && data.event) {
      child.push(data.event);
    }
  }
  return child;
}
