export interface StateMachineEventMap<TPhase extends string> {
  transition: CustomEvent<{ from: TPhase; to: TPhase }>;
}

export interface StateMachineOptions<TPhase extends string> {
  initialPhase: TPhase;
  transitions: Record<TPhase, TPhase[]>;
}

export class StateMachine<TPhase extends string> extends EventTarget {
  private _phase: TPhase;
  private readonly initialPhase: TPhase;
  private readonly transitions: Record<TPhase, TPhase[]>;

  constructor(options: StateMachineOptions<TPhase>) {
    super();
    this._phase = options.initialPhase;
    this.initialPhase = options.initialPhase;
    this.transitions = options.transitions;
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
    this.dispatchEvent(new CustomEvent('transition', { detail: { from, to } }));
    return true;
  }

  silentTransition(to: TPhase): boolean {
    if (!this.canTransitionTo(to)) return false;
    this._phase = to;
    return true;
  }

  reset(): void {
    this._phase = this.initialPhase;
  }

  addEventListener<K extends keyof StateMachineEventMap<TPhase>>(
    type: K,
    listener: (ev: StateMachineEventMap<TPhase>[K]) => void,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
  ): void {
    super.addEventListener(type, listener);
  }
}
