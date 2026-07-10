import type { AgentRunContext } from '../port/agent-run-context.port';
import type { RunEvent } from '@/shared/types/events';

export type HookPhase =
  | 'pre-llm'
  | 'post-llm'
  | 'post-observation'
  | 'loop-exit';

export interface Hook {
  readonly id: string;
  readonly phase: HookPhase;
  apply: (ctx: AgentRunContext) => AsyncGenerator<RunEvent>;
}

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
