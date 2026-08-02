import { describe, it, expect } from 'vitest';
import { Role } from '@/shared/types/entities';
import type { ReActStep } from '@/shared/types/render';
import {
  MessageNode,
  stepsToTimeline,
  stepsToToolCalls,
} from '@/client/store/modules/message-node';

const step = (over: Partial<ReActStep>): ReActStep => ({
  thought: '',
  startedAt: 0,
  ...over,
});

describe('stepsToTimeline', () => {
  it('interleaves thought+tool in arrival order and drops empty thoughts', () => {
    expect(
      stepsToTimeline([
        step({
          thought: 'think A',
          action: {
            callId: 'c1',
            toolName: 'Bash',
            toolArgs: {},
            status: 'completed',
          },
        }),
        step({
          action: {
            callId: 'c2',
            toolName: 'Ls',
            toolArgs: {},
            status: 'pending',
          },
        }),
        step({ thought: 'only thought' }),
      ]),
    ).toEqual([
      { kind: 'thought', key: 'th_0', content: 'think A' },
      { kind: 'tool', key: 'c1', callId: 'c1' },
      { kind: 'tool', key: 'c2', callId: 'c2' },
      { kind: 'thought', key: 'th_2', content: 'only thought' },
    ]);
  });
});

describe('stepsToToolCalls', () => {
  it('maps steps with actions, carrying observation as output', () => {
    const calls = stepsToToolCalls([
      step({
        action: {
          callId: 'c1',
          toolName: 'Bash',
          toolArgs: { cmd: 'ls' },
          status: 'completed',
        },
        observation: 'a\nb',
      }),
      step({ thought: 'no action' }),
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      callId: 'c1',
      toolName: 'Bash',
      status: 'completed',
      output: 'a\nb',
    });
  });
});

describe('MessageNode.applyView', () => {
  const view = (
    over: Partial<{
      content: string;
      status: 'running' | 'completed';
      steps: ReActStep[];
    }>,
  ) => ({
    content: '',
    steps: [],
    status: 'running' as const,
    awaitingInput: null,
    audio: null,
    ...over,
  });
  const make = () =>
    new MessageNode({
      id: 'm1',
      conversationId: 'cv',
      role: Role.ASSIST,
      createdAt: new Date(0),
    });

  it('updates content/status, derives timeline, and ignores late frames once terminal', () => {
    const n = make();
    n.applyView(view({ content: 'hel', steps: [step({ thought: 't' })] }));
    expect(n.content).toBe('hel');
    expect(n.timeline).toHaveLength(1);
    expect(n.isTerminal).toBe(false);

    n.applyView(view({ content: 'hello', status: 'completed' }));
    expect(n.isTerminal).toBe(true);

    n.applyView(view({ content: 'STALE', status: 'running' }));
    expect(n.content).toBe('hello');
    expect(n.isTerminal).toBe(true);
  });

  it('status getters distinguish thinking / streaming', () => {
    const n = make();
    expect(n.isInitialized).toBe(true);
    n.applyView(view({})); // running, no content, no tools
    expect(n.isThinking).toBe(true);
    n.applyView(view({ content: 'x' }));
    expect(n.isStreaming).toBe(true);
    expect(n.isThinking).toBe(false);
  });
});
