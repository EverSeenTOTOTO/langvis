import { ChatPhase } from '@/shared/types';
import { makeAutoObservable } from 'mobx';

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

  // === Phase transitions ===

  transition(to: ChatPhase): void {
    // Terminal states are idempotent
    if (
      this.phase === 'idle' ||
      this.phase === 'error' ||
      this.phase === 'cancelled'
    ) {
      if (to !== 'connecting') return;
    }

    this.phase = to;
  }

  setPhase(phase: ChatPhase, error?: string): void {
    this.phase = phase;
    if (error !== undefined) {
      this.phaseError = error;
    }
  }

  // === SSE Connection ===

  setEventSource(es: EventSource | null): void {
    this.eventSource = es;
  }

  closeEventSource(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
  }

  // === Cleanup ===

  reset(): void {
    this.closeEventSource();
    this.phase = 'idle';
    this.phaseError = null;
  }
}
