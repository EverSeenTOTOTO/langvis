import type { AgentRunContext } from '../port/agent-run-context.port';

/** Hook 触发的 loop 边界。loop-exit = response_user 终态点（loop 即将退出）。 */
export type HookPhase =
  | 'pre-llm'
  | 'post-llm'
  | 'post-observation'
  | 'loop-exit';

/** Hook 本轮生效后的事实摘要（供 hook 事件）。 */
export interface HookEffect {
  summary: string;
  data?: unknown;
}

/**
 * Hook —— 系统发起的上下文变换（经 ctx.workingMemory 读写缝）。
 * `apply` 返回 HookEffect 表示本轮生效（供事件），返回 null 表示未生效（自判、不动）。
 * 不设 `condition` 字段：是否生效由 apply 内部决定（不动即原样返回 null）。
 * 签名只命名 AgentRunContext port、不引用 WorkingMemory 具体类——memory 改造时只换 apply 体，签名不动。
 */
export interface Hook {
  readonly id: string;
  readonly phase: HookPhase;
  apply: (ctx: AgentRunContext) => Promise<HookEffect | null>;
}

/**
 * HookPlan —— 有序 hook 列表，按相位索引。
 * 经 LaunchParams 注入、暴露于 AgentRunContext；loop 在边界按相位取并依次 apply。
 */
export class HookPlan {
  private readonly byPhase: Readonly<Record<HookPhase, readonly Hook[]>>;

  constructor(hooks: readonly Hook[] = []) {
    this.byPhase = {
      'pre-llm': hooks.filter(h => h.phase === 'pre-llm'),
      'post-llm': hooks.filter(h => h.phase === 'post-llm'),
      'post-observation': hooks.filter(h => h.phase === 'post-observation'),
      'loop-exit': hooks.filter(h => h.phase === 'loop-exit'),
    };
  }

  forPhase(phase: HookPhase): readonly Hook[] {
    return this.byPhase[phase];
  }
}
