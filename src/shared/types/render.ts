/**
 * 投影值对象 — 从 Agent 领域事件实时沉淀到 Message 的结构化记录。
 *
 * @see docs/plans/2026-05-30-ddd-refactor/03-conversation.md
 */

/**
 * ask_user / awaiting_input 提示的投影 —— run 阻塞等待用户输入时非空。
 * 随 run_view 帧下发（实时 / 重连 / 历史同此一帧），前端据以渲染确认表单。
 */
export interface AwaitingInputProjection {
  callId: string;
  message: string;
  schema: Record<string, unknown>;
}

/**
 * ReAct 推理步骤 — 将 thought + action + observation 绑定为一个原子单元。
 * ChatAgent 场景下 steps 为空，仅累积 content。
 */
export interface ReActStep {
  thought: string;
  action?: {
    callId: string;
    toolName: string;
    toolArgs: Record<string, unknown>;
    /** Lifecycle of the tool call. Set by the projection so renderers can show
     * pending / failed states without inferring from completedAt. */
    status: 'pending' | 'completed' | 'failed';
    /** Present when status === 'failed' (from tool_error). */
    error?: string;
    /** 工具进度（call_subagents 的 { childRunId, event }[]、Bash 的 stdout/stderr
     * 块等）；实时累积或 projectRun 重建。 */
    progress?: unknown[];
  };
  observation?: string;
  startedAt: number;
  completedAt?: number;
}
