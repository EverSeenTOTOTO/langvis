export interface StateMachineOptions<TPhase extends string> {
  initialPhase: TPhase;
  transitions: Record<TPhase, TPhase[]>;
  onTransition?: (from: TPhase, to: TPhase) => void;
}

export class StateMachine<TPhase extends string> {
  private _phase: TPhase;
  private readonly transitions: Record<TPhase, TPhase[]>;
  private readonly onTransition?: (from: TPhase, to: TPhase) => void;

  constructor(options: StateMachineOptions<TPhase>) {
    this._phase = options.initialPhase;
    this.transitions = options.transitions;
    this.onTransition = options.onTransition;
  }

  get phase(): TPhase {
    return this._phase;
  }

  canTransitionTo(to: TPhase): boolean {
    return this.transitions[this._phase].includes(to);
  }

  transition(to: TPhase): boolean {
    if (!this.canTransitionTo(to)) return false;
    const from = this._phase;
    this._phase = to;
    this.onTransition?.(from, to);
    return true;
  }

  silentTransition(to: TPhase): boolean {
    if (!this.canTransitionTo(to)) return false;
    this._phase = to;
    return true;
  }
}
