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
import type { Role } from '@/shared/types/entities';

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

export interface Task<S = unknown> {
  readonly id: string;
  readonly domain: string;
  readonly difficulty: 'easy' | 'medium' | 'hard';
  userGoal: string;
  /**
   * 构造本任务（本域）的 per-run 沙箱 + 该域虚构工具定义 + ToolSet。
   * 工具类是无状态 singleton（注册一次），沙箱经 runId 绑定（见 sandbox-registry），
   * 故每次 setup 返回的 tools 是同一批 def、sandbox 是 fresh 实例。
   */
  setup(): { sandbox: S; tools: FictionalToolDef[]; toolSet: ToolSet };
  /** 可选：workDir 注入后、run 执行前调用，向沙箱目录预置文件（如把 PDF 拷进 workDir）。
   *  setup() 先于 workDir 返回，故文件预置须在此钩子（runner 在 attachWorkDir 后调用）。域无关。 */
  seedWorkDir?(workDir: string): void | Promise<void>;
  /** 规则式判官：断言沙箱末态 + 对话属性。sandbox 即 setup() 返回的 S。 */
  success(sandbox: S, run: AgentRun, events: readonly EnrichedEvent[]): Grade;
  /** 安全探针。 */
  readonly safety?: { expectRefusal?: boolean; forbidTool?: string };
  /** 可选效率预算（"设计暴露"对比用，非硬门槛）。 */
  readonly budget?: { maxIterations?: number; maxPeakContext?: number };
}

/**
 * 多 turn 任务：user 消息序列逐轮驱动，轮间跑完整 conv 变换链
 * （summary-attach @ turn-start、compact @ turn-end），跨轮共享沙箱。
 *
 * 这是让四条压缩机制都可观测的前提——单 turn eval 只测 mid-loop 轮内那一条；
 * 多 turn 才驱动 processSummary 的 produce→attach→回注 闭环与 history 压缩。
 * success 拿到末轮 run + **跨全部 turn 合并**的 events。
 */
export interface MultiTurnTask<S = unknown> extends Omit<Task<S>, 'userGoal'> {
  readonly turns: string[];
  /** 可选：注入 system 之后、turns 之前的会话历史（如"错误示范"坏 demo，测抗 in-context-learning 投毒 / 审计反幻觉）。runner 填 id/conversationId/createdAt。域无关。 */
  readonly seedHistory?: ReadonlyArray<{ role: Role; content: string }>;
}

export interface EfficiencyMetrics {
  /** LLM 迭代数（= tool_call 事件数，含终态 response_user——跨模型为常数偏移）。 */
  iterations: number;
  toolCalls: number;
  peakContext: number;
  /** Σ loop_usage.used，≈累计 billed token（同 CumulativeBudgetHook 口径）。 */
  cumulativeCostProxy: number;
  durationMs: number;
}

export interface DesignMetrics {
  toolErrors: number;
  errorTools: string[];
  compactionTriggers: number;
  /** guard hook 触发终止（CumulativeBudgetHook/StuckHook/MaxIterationsHook 各自发的 hook 事件）。 */
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
  /** 会话隔离的 workDir（排查产物用：FS 任务产物在此；= 日志关联键的文件夹名）。 */
  workDir?: string;
  /** driver 配置变体名（配置轴）；缺省（含旧 jsonl）= compact-only。 */
  variant?: string;
  /** 多 turn 任务的轮数（单 turn = 1）。 */
  turns?: number;
  /** turn-end CompactTransform 触发次数（= ctx.messages 中 meta.kind='compact' 条数）。
   *  会话级压缩"触发与否"的核心读数；单 turn 任务恒 0。 */
  historyCompactions?: number;
  /** 事件 type 序列——排查用，省空间（完整事件可按需开）。 */
  eventTrace: RunEvent['type'][];
}
