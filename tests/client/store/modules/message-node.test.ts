import { describe, it, expect } from 'vitest';
import { MessageNode } from '@/client/store/modules/message-node';
import type { SSEFrame } from '@/shared/types/events';
import { Role } from '@/shared/types/entities';
import type { ReActStep, PendingMessageSnapshot } from '@/shared/types/render';

/** Minimal business-frame factory: every frame is an EnrichedEvent + messageId. */
function frame(partial: Record<string, unknown> & { seq: number }): SSEFrame {
  return {
    runId: 'run_1',
    at: 0,
    messageId: 'm1',
    ...partial,
  } as SSEFrame;
}

function liveNode(): MessageNode {
  return new MessageNode({
    id: 'm1',
    conversationId: 'c1',
    role: Role.ASSIST,
    createdAt: new Date(),
  });
}

describe('MessageNode — process timeline', () => {
  it('records thoughts and tool calls in arrival order', () => {
    const node = liveNode();
    node.handleFrame(frame({ seq: 1, type: 'thought', content: 'think A' }));
    node.handleFrame(
      frame({
        seq: 2,
        type: 'tool_call',
        callId: 'tc_1',
        toolName: 'search',
        toolArgs: { q: 'x' },
      }),
    );
    node.handleFrame(frame({ seq: 3, type: 'thought', content: 'think B' }));
    node.handleFrame(
      frame({
        seq: 4,
        type: 'tool_call',
        callId: 'tc_2',
        toolName: 'search',
        toolArgs: { q: 'y' },
      }),
    );

    expect(node.timeline.map(i => i.kind)).toEqual([
      'thought',
      'tool',
      'thought',
      'tool',
    ]);
    // The two thoughts interleave with — not pile after — their tools.
    expect(node.timeline[0]).toMatchObject({
      kind: 'thought',
      content: 'think A',
    });
    expect(node.timeline[1]).toMatchObject({ kind: 'tool', callId: 'tc_1' });
    expect(node.timeline[3]).toMatchObject({ kind: 'tool', callId: 'tc_2' });
  });

  it('updates a tool in place instead of appending a new timeline item', () => {
    const node = liveNode();
    node.handleFrame(
      frame({
        seq: 1,
        type: 'tool_call',
        callId: 'tc_1',
        toolName: 'search',
        toolArgs: {},
      }),
    );
    node.handleFrame(
      frame({ seq: 2, type: 'tool_result', callId: 'tc_1', output: 'ok' }),
    );

    expect(node.timeline.filter(i => i.kind === 'tool')).toHaveLength(1);
    expect(node.toolCalls[0].status).toBe('completed');
    expect(node.toolCalls[0].output).toBe('ok');
  });

  it('positions ask_user against its owning tool (callId match)', () => {
    const node = liveNode();
    node.handleFrame(
      frame({
        seq: 1,
        type: 'tool_call',
        callId: 'tc_ask',
        toolName: 'ask_user',
        toolArgs: {},
      }),
    );
    node.handleFrame(
      frame({
        seq: 2,
        type: 'tool_progress',
        callId: 'tc_ask',
        data: {
          status: 'awaiting_input',
          schema: { name: { type: 'string' } },
          message: 'Your name?',
        },
      }),
    );

    expect(node.awaitingInput).not.toBeNull();
    expect(node.awaitingInput?.callId).toBe('tc_ask');
    // The owning tool is present in the timeline at its arrival position.
    expect(node.timeline.some(i => i.kind === 'tool')).toBe(true);
  });

  it('derives timeline from steps on historical load (drops empty thoughts)', () => {
    const steps: ReActStep[] = [
      {
        thought: 'reason first',
        action: { callId: 'tc_1', toolName: 'search', toolArgs: {} },
        observation: 'obs',
        startedAt: 1,
        completedAt: 2,
      },
      {
        thought: '', // thoughtless step — contributes only its tool
        action: { callId: 'tc_2', toolName: 'search', toolArgs: {} },
        observation: 'obs2',
        startedAt: 3,
        completedAt: 4,
      },
    ];
    const node = new MessageNode({
      id: 'm1',
      conversationId: 'c1',
      role: Role.ASSIST,
      createdAt: new Date(),
      status: 'completed',
      steps,
    });

    expect(node.timeline.map(i => i.kind)).toEqual(['thought', 'tool', 'tool']);
    expect(node.timeline[0]).toMatchObject({
      kind: 'thought',
      content: 'reason first',
    });
    expect(node.timeline[1]).toMatchObject({ kind: 'tool', callId: 'tc_1' });
    expect(node.timeline[2]).toMatchObject({ kind: 'tool', callId: 'tc_2' });
  });

  it('derives timeline from a reconnect snapshot', () => {
    const node = liveNode();
    node.handleFrame(frame({ seq: 1, type: 'thought', content: 'live' }));
    expect(node.timeline).toHaveLength(1);

    const snapshot: PendingMessageSnapshot = {
      messageId: 'm1',
      content: '',
      status: 'running',
      steps: [
        {
          thought: 'restored',
          action: { callId: 'tc_r', toolName: 'search', toolArgs: {} },
          startedAt: 1,
        },
      ],
    };
    node.applySnapshot(snapshot);

    expect(node.timeline.map(i => i.kind)).toEqual(['thought', 'tool']);
    expect(node.timeline[0]).toMatchObject({
      kind: 'thought',
      content: 'restored',
    });
  });
});
