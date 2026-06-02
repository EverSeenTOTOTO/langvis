import { describe, it, expect, vi } from 'vitest';
import { Conversation } from '@/server/modules/conversation/domain/conversation.entity';
import {
  DuplicateRunError,
  NoActiveRunError,
} from '@/server/modules/conversation/domain/conversation.errors';
import type { SSEFrame } from '@/shared/types/events';
import type { Message } from '@/shared/types/entities';
import type { AgentRun } from '@/server/modules/agent/domain/agent-run.entity';
import { Transport } from '@/shared/transport';
import type { SessionPhase } from '@/shared/types';

function createMockRun(overrides: Partial<AgentRun> = {}): AgentRun {
  const run = {
    messageId: 'msg_1',
    isTerminated: false,
    status: 'running' as const,
    cancel: vi.fn(),
    fail: vi.fn(),
    bufferedEvents: [],
    toSnapshot: vi.fn().mockReturnValue({
      runId: 'run_1',
      messageId: 'msg_1',
      status: 'running',
      content: '',
      toolCallRecords: [],
      thoughts: [],
    }),
    content: '',
    getToolCallRecords: vi.fn().mockReturnValue([]),
    nextSeq: vi.fn().mockReturnValue(1),
    signal: new AbortController().signal,
    getContextUsage: vi.fn().mockReturnValue({ used: 100, total: 1000 }),
    ...overrides,
  } as unknown as AgentRun;
  return run;
}

function createMockMessage(id = 'msg_1'): Message {
  return {
    id,
    role: 'assistant' as any,
    content: '',
    attachments: null,
    status: 'initialized',
    meta: null,
    createdAt: new Date(),
    conversationId: 'conv_1',
  };
}

class MockTransport extends Transport<SSEFrame> {
  isConnected = true;
  isConnecting = false;
  sentFrames: SSEFrame[] = [];

  connect = vi.fn().mockResolvedValue(undefined);
  send = vi.fn((frame: SSEFrame) => {
    this.sentFrames.push(frame);
    return true;
  });
  close = vi.fn(() => {
    this.isConnected = false;
  });
  disconnect = vi.fn();
}

describe('Conversation', () => {
  function createConversation(
    id = 'conv_1',
    opts?: { idleTimeoutMs?: number },
  ) {
    return new Conversation(id, {
      idleTimeoutMs: opts?.idleTimeoutMs,
    });
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

  it('should transition to active after registerRun', () => {
    const conv = createConversation();
    const run = createMockRun();
    const message = createMockMessage();

    conv.registerRun(message, run);

    expect(conv.phase).toBe('active');
    expect(conv.isActive).toBe(true);
    expect(getPhaseChanges(conv)).toEqual([{ id: 'conv_1', phase: 'active' }]);
  });

  it('should return to waiting after finalizeRun', () => {
    const conv = createConversation();
    const run = createMockRun();
    conv.registerRun(createMockMessage(), run);

    conv.finalizeRun('msg_1');

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

  // ── registerRun ──

  it('should throw DuplicateRunError on duplicate messageId', () => {
    const conv = createConversation();
    const run1 = createMockRun();
    const run2 = createMockRun();
    const message = createMockMessage();

    conv.registerRun(message, run1);
    expect(() => conv.registerRun(message, run2)).toThrow(DuplicateRunError);
  });

  // ── cancelAll ──

  it('should cancel all runs', () => {
    const conv = createConversation();
    const run1 = createMockRun({ messageId: 'msg_1' } as any);
    const run2 = createMockRun({ messageId: 'msg_2' } as any);

    conv.registerRun(createMockMessage('msg_1'), run1);
    conv.registerRun(createMockMessage('msg_2'), run2);

    conv.cancelAll('test reason');

    expect(run1.cancel).toHaveBeenCalledWith('test reason');
    expect(run2.cancel).toHaveBeenCalledWith('test reason');
  });

  it('should set canceling phase when cancelAll called with active runs', () => {
    const conv = createConversation();
    const run = createMockRun();
    conv.registerRun(createMockMessage(), run);

    conv.cancelAll();
    expect(conv.phase).toBe('canceling');
  });

  it('should handle already terminated runs in cancelAll', () => {
    const conv = createConversation();
    const terminatedRun = createMockRun();
    (terminatedRun as any).isTerminated = true;

    conv.registerRun(createMockMessage(), terminatedRun);
    conv.cancelAll();

    expect(terminatedRun.cancel).not.toHaveBeenCalled();
  });

  // ── cancelMessage ──

  it('should cancel specific message run', () => {
    const conv = createConversation();
    const run = createMockRun();
    conv.registerRun(createMockMessage(), run);

    conv.cancelMessage('msg_1');
    expect(run.cancel).toHaveBeenCalledWith('Cancelled by user');
  });

  it('should throw NoActiveRunError for unknown messageId', () => {
    const conv = createConversation();
    expect(() => conv.cancelMessage('unknown')).toThrow(NoActiveRunError);
  });

  // ── getRun ──

  it('should get run by messageId', () => {
    const conv = createConversation();
    const run = createMockRun();
    conv.registerRun(createMockMessage(), run);

    expect(conv.getRun('msg_1')).toBe(run);
    expect(conv.getRun('unknown')).toBeUndefined();
  });

  // ── finalizeRun ──

  it('should return entry from finalizeRun', () => {
    const conv = createConversation();
    const run = createMockRun();
    const message = createMockMessage();
    conv.registerRun(message, run);

    const entry = conv.finalizeRun('msg_1');
    expect(entry).toEqual({ message, run });
    expect(conv.getRun('msg_1')).toBeUndefined();
  });

  it('should return undefined for unknown messageId', () => {
    const conv = createConversation();
    expect(conv.finalizeRun('unknown')).toBeUndefined();
  });

  // ── attachTransport ──

  it('should attach transport and replay buffered events', () => {
    const conv = createConversation();
    const run = createMockRun();
    (run as any).bufferedEvents = [
      { type: 'start', runId: 'run_1', seq: 1, at: Date.now() },
      {
        type: 'text_chunk',
        runId: 'run_1',
        content: 'hello',
        seq: 2,
        at: Date.now(),
      },
    ];
    conv.registerRun(createMockMessage(), run);

    const transport = new MockTransport();
    conv.attachTransport(transport);

    // Should have replayed 2 events with messageId enriched
    expect(transport.send).toHaveBeenCalledTimes(2);
    expect(transport.sentFrames[0]).toMatchObject({
      type: 'start',
      messageId: 'msg_1',
    });
    expect(transport.sentFrames[1]).toMatchObject({
      type: 'text_chunk',
      messageId: 'msg_1',
    });
  });

  it('should not replay events for terminated runs', () => {
    const conv = createConversation();
    const terminatedRun = createMockRun();
    (terminatedRun as any).isTerminated = true;
    (terminatedRun as any).bufferedEvents = [
      { type: 'final', runId: 'run_1', seq: 1, at: Date.now() },
    ];
    conv.registerRun(createMockMessage(), terminatedRun);

    const transport = new MockTransport();
    conv.attachTransport(transport);

    expect(transport.send).toHaveBeenCalledTimes(0);
  });

  // ── send ──

  it('should return false when no connection', () => {
    const conv = createConversation();
    expect(conv.send({ type: 'connected' as const })).toBe(false);
  });

  it('should delegate send to connection', () => {
    const conv = createConversation();
    const transport = new MockTransport();
    conv.attachTransport(transport);

    expect(conv.send({ type: 'connected' as const })).toBe(true);
  });

  // ── dispose ──

  it('should dispose everything and emit domain event', () => {
    const conv = createConversation();
    const run = createMockRun();
    conv.registerRun(createMockMessage(), run);

    conv.dispose();

    expect(run.cancel).toHaveBeenCalled();
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
    const run = createMockRun();
    conv.registerRun(createMockMessage(), run);
    conv.finalizeRun('msg_1');

    // Only 2 phase_changed events (active, then waiting)
    expect(getPhaseChanges(conv)).toEqual([
      { id: 'conv_1', phase: 'active' },
      { id: 'conv_1', phase: 'waiting' },
    ]);
  });
});
