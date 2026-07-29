import type { AgentRunContext } from '../port/agent-run-context.port';
import type { RunEvent } from '@/shared/types/events';

export type HookPhase =
  | 'pre-llm'
  | 'pre-action'
  | 'post-observation'
  | 'loop-exit';

/**
 * Loop 流控信号——hook 经 throw 表态，loop 在 tick 外层 catch。替代旧字符串 directive。
 *
 * 不采用洋葱圈/中间件模型重构整个 loop：ReAct loop（llm→parse→tool）是带直接变量依赖的
 * 数据链，改成 composed steps 会让变量依赖走 stringly-typed 值，丢类型安全。故 loop 保留
 * 过程式，hook 仅在相位边界表态；数据走 yield event / ctx member，控制走 sentinel throw。
 *
 * - StopLoop：退出 loop。loop 自动接 loop-exit 相位。throw 者自负已 yield 终态事件（如 text_chunk）。
 * - ContinueTick：丢弃本 tick 剩余，进下一轮。throw 者自负留下的 messages 对下一轮/投影合法。
 * - （不 throw = 继续：跑同相位下一个 hook / loop 下一步，默认表态。）
 *
 * sentinel 是控制流、非错误：base 类便于 `instanceof` 区分，勿在 hook 的 catch 里吞掉。
 */
export class LoopSignal extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class StopLoop extends LoopSignal {
  constructor(reason?: string) {
    super(reason ?? 'stop loop');
  }
}

export class ContinueTick extends LoopSignal {
  constructor(reason?: string) {
    super(reason ?? 'continue to next tick');
  }
}

export interface Hook {
  readonly id: string;
  readonly phase: HookPhase;
  apply: (ctx: AgentRunContext) => AsyncGenerator<RunEvent, void>;
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
