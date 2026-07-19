import type { AgentRunContext } from '../port/agent-run-context.port';
import type { RunEvent } from '@/shared/types/events';

export type HookPhase =
  | 'pre-llm'
  | 'pre-action'
  | 'post-observation'
  | 'loop-exit';

/**
 * HookDirective — hook 如何影响 loop 流控
 *
 * 不采用洋葱圈/中间件模型重构整个 loop，只在现有相位 hook 上加一个扁平 directive
 * 返回值。理由：
 * 1. ReAct loop （llm→parse→tool）是带直接变量依赖的数据链。把 loop 改造成
 *    run composed steps，变量依赖就被迫走 stringly-typed 值（类似 ctx.getResult('some prev step key') as T），
 *    丢了局部变量的类型安全，把可见变量依赖变成隐式的步骤排序约定，损害可读性和可维护性。
 * 2. 唯一想要的额外能力——在昂贵操作（call llm）之前短路——扁平 directive 已
 *    足够达成（pre-llm hook 返回 'break' 即跳过本次 LLM 调用）。
 * 故 loop 保留过程式，hook 经 directive 表态；数据走 yield event / ctx member、
 * 控制走 directive，两条通道分开。
 *
 * 语义（对 runReactLoop 的外层 for）：
 * - 'next'     继续跑同 tick 下一个 hook / loop 下一步（默认表态，每个 hook 必须显式返回）。
 * - 'continue' 丢弃本 tick 剩余步骤，进入下一轮迭代。返回者自负留下的 messages 对
 *               下一轮 / 投影是 ReAct 合法的（如该补 observation 就自己 append）。
 * - 'break'    退出 loop。loop 会自动接 'loop-exit' 相位（ProcessSummary 横切）。
 *               返回者自负已 yield 终态事件（如答案走 text_chunk）。
 */
export type HookDirective = 'next' | 'continue' | 'break';

export interface Hook {
  readonly id: string;
  readonly phase: HookPhase;
  apply: (ctx: AgentRunContext) => AsyncGenerator<RunEvent, HookDirective>;
}

export class HookPlan {
  private readonly byPhase: Readonly<Record<HookPhase, readonly Hook[]>>;

  constructor(hooks: readonly Hook[] = []) {
    this.byPhase = {
      'pre-llm': hooks.filter(h => h.phase === 'pre-llm'),
      'pre-action': hooks.filter(h => h.phase === 'pre-action'),
      'post-observation': hooks.filter(h => h.phase === 'post-observation'),
      'loop-exit': hooks.filter(h => h.phase === 'loop-exit'),
    };
  }

  forPhase(phase: HookPhase): readonly Hook[] {
    return this.byPhase[phase];
  }
}
