import type { AgentRunContext } from '../port/agent-run-context.port';
import type { RunEvent } from '@/shared/types/events';

export type HookPhase =
  | 'pre-llm'
  | 'pre-action'
  | 'post-observation'
  | 'loop-exit';

// Loop 流控：hook 经 throw sentinel 表态，loop 在 tick 外层 catch。StopLoop 退出，ContinueTick 丢弃本 tick，不 throw 则继续。
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
