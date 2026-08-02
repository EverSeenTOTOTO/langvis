import type { ReActStep, AwaitingInputProjection } from '@/shared/types/render';
import type { EnrichedEvent, HookRecord } from '@/shared/types/events';

// 纯投影函数：把 agent run 事件流 fold 成读模型 RunView。实时下发、持久化、历史读回共用同一投影，保证一致。
export interface RunView {
  content: string;
  steps: ReActStep[];
  status: 'running' | 'completed' | 'failed' | 'cancelled';
  // Non-null while blocked on an ask_user / awaiting_input prompt.
  awaitingInput: AwaitingInputProjection | null;
  audio: { filePath: string; voice?: string } | null;
  /** 本次 run 中生效过的 hook 事实（按到达序累积）。 */
  hooks: HookRecord[];
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
    audio: null,
    hooks: [],
  };
}

// 当前未完成的 step（无 completedAt）；派生自 completedAt 使 reducer 保持纯 fold。
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

// 把单个事件 fold 进 view（原地变更并返回）；projectRun 即 reduce 到它。
export function applyEventToView(view: RunView, event: EnrichedEvent): RunView {
  switch (event.type) {
    case 'thought': {
      ensureStep(view, event.at).thought += event.content ?? '';
      break;
    }

    case 'tool_call': {
      // thought 可选——tool_call 可能无前置 thought，这里开 step 防投影丢弃。
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
      // 保留全部 tool progress——live 渲染器直接读投影视图，此处不可丢弃。
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

    case 'audio':
      view.audio = { filePath: event.filePath, voice: event.voice };
      break;

    case 'hook':
      view.hooks.push({
        hookId: event.hookId,
        summary: event.summary,
        data: event.data,
      });
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

// 提取子 run 事件流：CallSubagents 以 tool_progress { childRunId, event } 转发，这里过滤解包。
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
