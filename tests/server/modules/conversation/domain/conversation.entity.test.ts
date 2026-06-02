import { describe, it, expect } from 'vitest';
import { Conversation } from '@/server/modules/conversation/domain/conversation.entity';
import { DuplicateRunError } from '@/server/modules/conversation/domain/conversation.errors';
import type { SessionPhase } from '@/shared/types';

describe('Conversation', () => {
  function createConversation(id = 'conv_1') {
    return new Conversation(id);
  }

  /** Extract phase_changed events from domain events */
  function getPhaseChanges(
    conv: Conversation,
  ): Array<{ id: string; phase: SessionPhase }> {
    return conv.domainEvents
      .filter(e => e.type === 'phase_changed')
      .map(e => ({
        id: e.aggregateId,
        phase: (e.payload as { to: SessionPhase }).to,
      }));
  }

  /** Check if conversation_disposed event exists */
  function hasDisposedEvent(conv: Conversation): boolean {
    return conv.domainEvents.some(e => e.type === 'conversation_disposed');
  }

  // ── Phase derivation ──

  it('should start in waiting phase', () => {
    const conv = createConversation();
    expect(conv.phase).toBe('waiting');
    expect(conv.isActive).toBe(false);
  });

  it('should transition to active after startTurn', () => {
    const conv = createConversation();
    conv.startTurn('msg_1');

    expect(conv.phase).toBe('active');
    expect(conv.isActive).toBe(true);
    expect(getPhaseChanges(conv)).toEqual([{ id: 'conv_1', phase: 'active' }]);
  });

  it('should return to waiting after completeTurn', () => {
    const conv = createConversation();
    conv.startTurn('msg_1');
    conv.clearEvents();

    conv.completeTurn('msg_1');

    expect(conv.phase).toBe('waiting');
    const phases = getPhaseChanges(conv);
    expect(phases.at(-1)).toEqual({ id: 'conv_1', phase: 'waiting' });
  });

  it('should transition to done after dispose', () => {
    const conv = createConversation();
    conv.dispose();
    expect(conv.phase).toBe('done');
    expect(conv.isDisposed).toBe(true);
  });

  // ── startTurn ──

  it('should throw DuplicateRunError on duplicate messageId', () => {
    const conv = createConversation();
    conv.startTurn('msg_1');
    expect(() => conv.startTurn('msg_1')).toThrow(DuplicateRunError);
  });

  it('should emit turn_started event', () => {
    const conv = createConversation();
    conv.startTurn('msg_1');

    const events = conv.domainEvents.filter(e => e.type === 'turn_started');
    expect(events).toHaveLength(1);
    expect((events[0].payload as { messageId: string }).messageId).toBe(
      'msg_1',
    );
  });

  // ── completeTurn ──

  it('should emit turn_completed event', () => {
    const conv = createConversation();
    conv.startTurn('msg_1');
    conv.clearEvents();

    conv.completeTurn('msg_1');

    const events = conv.domainEvents.filter(e => e.type === 'turn_completed');
    expect(events).toHaveLength(1);
  });

  it('should stay active if other runs remain', () => {
    const conv = createConversation();
    conv.startTurn('msg_1');
    conv.startTurn('msg_2');

    conv.completeTurn('msg_1');

    expect(conv.phase).toBe('active');
    expect(conv.isActive).toBe(true);
  });

  // ── requestCancellation ──

  it('should emit turn_cancellation_requested for single message', () => {
    const conv = createConversation();
    conv.startTurn('msg_1');

    conv.requestCancellation('msg_1', 'test reason');

    const events = conv.domainEvents.filter(
      e => e.type === 'turn_cancellation_requested',
    );
    expect(events).toHaveLength(1);
    expect((events[0].payload as { messageId: string }).messageId).toBe(
      'msg_1',
    );
  });

  it('should emit turn_cancellation_requested for all active messages', () => {
    const conv = createConversation();
    conv.startTurn('msg_1');
    conv.startTurn('msg_2');

    conv.requestCancellation(undefined, 'cancel all');

    const events = conv.domainEvents.filter(
      e => e.type === 'turn_cancellation_requested',
    );
    expect(events).toHaveLength(2);
    expect(conv.phase).toBe('canceling');
  });

  // ── dispose ──

  it('should dispose and emit domain event', () => {
    const conv = createConversation();
    conv.startTurn('msg_1');

    conv.dispose();

    expect(hasDisposedEvent(conv)).toBe(true);
    expect(conv.isDisposed).toBe(true);
    expect(conv.phase).toBe('done');
  });

  it('should not dispose twice', () => {
    const conv = createConversation();
    conv.dispose();
    conv.dispose();

    // Only one conversation_disposed event (second dispose returns early)
    const disposedCount = conv.domainEvents.filter(
      e => e.type === 'conversation_disposed',
    ).length;
    expect(disposedCount).toBe(1);
  });

  // ── Phase change domain events ──

  it('should not emit event if phase unchanged', () => {
    const conv = createConversation();
    // phase is 'waiting', register and finalize should yield:
    // waiting → active → waiting = 2 changes
    conv.startTurn('msg_1');
    conv.completeTurn('msg_1');

    // Only 2 phase_changed events (active, then waiting)
    expect(getPhaseChanges(conv)).toEqual([
      { id: 'conv_1', phase: 'active' },
      { id: 'conv_1', phase: 'waiting' },
    ]);
  });

  // ── hasActiveMessage ──

  it('should report active message correctly', () => {
    const conv = createConversation();
    expect(conv.hasActiveMessage('msg_1')).toBe(false);

    conv.startTurn('msg_1');
    expect(conv.hasActiveMessage('msg_1')).toBe(true);

    conv.completeTurn('msg_1');
    expect(conv.hasActiveMessage('msg_1')).toBe(false);
  });
});
