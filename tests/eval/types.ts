/**
 * eval harness 域无关类型。不含任何具体业务域（flight/safety/…）形状——
 * 域把自家沙箱形状塞进 Task&lt;S&gt; 的 S，runner 不感知 S 内部。
 */
import type { ToolConfig } from '@/shared/types';
import type { ToolConstructor } from '@/server/modules/agent/domain/model/tool.base';
import type { ToolSet } from '@/server/modules/agent/domain/model/tool-set.vo';
import type { AgentRun } from '@/server/modules/agent/domain/model/agent-run.entity';
import type { EnrichedEvent, RunEvent } from '@/shared/types/events';
import type { RunStatus } from '@/shared/types/agent';

export interface Grade {
  pass: boolean;
  reason: string;
}

/** 虚构工具定义：runner 经 registerTool 注册（idempotent），id 即容器 token。 */
export type FictionalToolDef = {
  id: string;
  Clz: ToolConstructor;
  config: ToolConfig<any, any>;
};

export interface JudgeSpec {
  /** rubric 文案；判官模型据 final answer + 此 rubric 出 pass/fail。 */
  rubric: string;
}

export interface Task<S = unknown> {
  readonly id: string;
  readonly domain: string;
  readonly difficulty: 'easy' | 'medium' | 'hard';
  readonly userGoal: string;
  /**
   * 构造本任务（本域）的 per-run 沙箱 + 该域虚构工具定义 + ToolSet。
   * 工具类是无状态 singleton（注册一次），沙箱经 runId 绑定（见 sandbox-registry），
   * 故每次 setup 返回的 tools 是同一批 def、sandbox 是 fresh 实例。
   */
  setup(): { sandbox: S; tools: FictionalToolDef[]; toolSet: ToolSet };
  /** 规则式判官：断言沙箱末态 + 对话属性。sandbox 即 setup() 返回的 S。 */
  success(sandbox: S, run: AgentRun, events: readonly EnrichedEvent[]): Grade;
  /** 模糊正确性才填；存在时与 success 取合取（rule && judge）。 */
  readonly judge?: JudgeSpec;
  /** 安全探针。 */
  readonly safety?: { expectRefusal?: boolean; forbidTool?: string };
  /** 可选效率预算（"设计暴露"对比用，非硬门槛）。 */
  readonly budget?: { maxIterations?: number; maxPeakContext?: number };
}

export interface EfficiencyMetrics {
  /** LLM 迭代数（= tool_call 事件数，含终态 response_user——跨模型为常数偏移）。 */
  iterations: number;
  toolCalls: number;
  peakContext: number;
  /** Σ loop_usage.used，≈累计 billed token（同 BudgetHook 口径）。 */
  cumulativeCostProxy: number;
  durationMs: number;
}

export interface DesignMetrics {
  toolErrors: number;
  errorTools: string[];
  compactionTriggers: number;
  /** guard hook 触发终止（BudgetHook/StuckHook/MaxIterationsHook 各自发的 hook 事件）。 */
  budgetHit: boolean;
  stuckHit: boolean;
  iterationCapHit: boolean;
  /** 最高重复 (toolName+args) 次数——卡死/冗余调用信号。 */
  redundantCalls: number;
}

export interface RunOutcome {
  task: string;
  model: string;
  trial: number;
  status: RunStatus;
  correctness: Grade;
  efficiency: EfficiencyMetrics;
  design: DesignMetrics;
  safety?: Grade;
  durationMs: number;
  /** 事件 type 序列——排查用，省空间（完整事件可按需开）。 */
  eventTrace: RunEvent['type'][];
}
