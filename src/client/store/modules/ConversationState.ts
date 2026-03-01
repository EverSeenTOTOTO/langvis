import { ChatPhase } from '@/shared/types';
import { makeAutoObservable } from 'mobx';

/**
 * Valid phase transitions:
 *   idle → connecting
 *   connecting → streaming | error | cancelled
 *   streaming → finishing | error | cancelled
 *   finishing → idle | error
 *
 * Terminal states (error, cancelled) can only exit via reset()
 */
const VALID_TRANSITIONS: Record<ChatPhase, ChatPhase[]> = {
  idle: ['connecting'],
  connecting: ['streaming', 'error', 'cancelled'],
  streaming: ['finishing', 'error', 'cancelled'],
  finishing: ['idle', 'error'],
  error: [],
  cancelled: [],
};

/**
 * ConversationState - runtime state container for a single conversation
 * Simplified: only manages phase and SSE connection, no typewriter
 */
export class ConversationState {
  // === Observable state ===
  phase: ChatPhase = 'idle';
  phaseError: string | null = null;

  // === Non-observable technical details ===
  eventSource: EventSource | null = null;

  constructor() {
    makeAutoObservable<this, 'eventSource'>(this, {
      eventSource: false,
    });
  }

  get isLoading(): boolean {
    return (
      this.phase !== 'idle' &&
      this.phase !== 'error' &&
      this.phase !== 'cancelled'
    );
  }

  transition(to: ChatPhase, error?: string): void {
    if (!VALID_TRANSITIONS[this.phase].includes(to)) return;

    this.phase = to;
    if (error !== undefined) {
      this.phaseError = error;
    }
  }

  // === SSE Connection ===

  setEventSource(es: EventSource | null): void {
    this.eventSource = es;
  }

  closeEventSource(): void {
    this.eventSource?.close();
    this.eventSource = null;
  }

  reset(): void {
    this.closeEventSource();
    this.phase = 'idle';
    this.phaseError = null;
  }
}
