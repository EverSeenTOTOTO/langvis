import { describe, it, expect } from 'vitest';
import { MessageNode } from '@/client/store/modules/message-node';
import { Role } from '@/shared/types/entities';
import type { ReActStep, AwaitingInputProjection } from '@/shared/types/render';
import type { RunStatus } from '@/shared/types/agent';

/** Build an applyView payload (the shape of a run_view frame's projected fields). */
function view(partial: {
  content?: string;
  steps?: ReActStep[];
  status?: RunStatus;
  awaitingInput?: AwaitingInputProjection | null;
  audio?: { filePath: string; voice?: string } | null;
}) {
  return {
    content: partial.content ?? '',
    steps: partial.steps ?? [],
    status: (partial.status ?? 'running') as RunStatus,
    awaitingInput: partial.awaitingInput ?? null,
    audio: partial.audio ?? null,
  };
}

function liveNode(): MessageNode {
  return new MessageNode({
    id: 'm1',
    conversationId: 'c1',
    role: Role.ASSIST,
    createdAt: new Date(),
  });
}

function step(partial: Partial<ReActStep> & { startedAt?: number }): ReActStep {
  return { thought: '', startedAt: 1, ...partial } as ReActStep;
}

describe('MessageNode — process timeline (applyView)', () => {
  it('derives interleaved thought/tool timeline from steps', () => {
    const node = liveNode();
    node.applyView(
      view({
        steps: [
          step({
            thought: 'think A',
            startedAt: 1,
            action: {
              callId: 'tc_1',
              toolName: 'search',
              toolArgs: {},
              status: 'completed',
            },
          }),
          step({
            thought: 'think B',
            startedAt: 2,
            action: {
              callId: 'tc_2',
              toolName: 'search',
              toolArgs: {},
              status: 'completed',
            },
          }),
        ],
      }),
    );

    expect(node.timeline.map(i => i.kind)).toEqual([
      'thought',
      'tool',
      'thought',
      'tool',
    ]);
    expect(node.timeline[0]).toMatchObject({
      kind: 'thought',
      content: 'think A',
    });
    expect(node.timeline[1]).toMatchObject({ kind: 'tool', callId: 'tc_1' });
    expect(node.timeline[3]).toMatchObject({ kind: 'tool', callId: 'tc_2' });
  });

  it('derives a completed tool call from a step', () => {
    const node = liveNode();
    node.applyView(
      view({
        steps: [
          step({
            action: {
              callId: 'tc_1',
              toolName: 'search',
              toolArgs: {},
              status: 'completed',
            },
            observation: 'ok',
            completedAt: 2,
          }),
        ],
      }),
    );

    expect(node.timeline.filter(i => i.kind === 'tool')).toHaveLength(1);
    expect(node.toolCalls[0].status).toBe('completed');
    expect(node.toolCalls[0].output).toBe('ok');
  });

  it('surfaces awaitingInput from the projected view', () => {
    const node = liveNode();
    const awaiting: AwaitingInputProjection = {
      callId: 'tc_ask',
      message: 'Your name?',
      schema: { name: { type: 'string' } },
    };
    node.applyView(
      view({
        awaitingInput: awaiting,
        steps: [
          step({
            action: {
              callId: 'tc_ask',
              toolName: 'ask_user',
              toolArgs: {},
              status: 'pending',
            },
          }),
        ],
      }),
    );

    expect(node.awaitingInput).not.toBeNull();
    expect(node.awaitingInput?.callId).toBe('tc_ask');
    expect(node.timeline.some(i => i.kind === 'tool')).toBe(true);
  });

  it('each applyView replaces state (reconnect/late frames)', () => {
    const node = liveNode();
    node.applyView(view({ content: 'live', steps: [] }));
    expect(node.content).toBe('live');

    node.applyView(
      view({
        steps: [
          step({
            thought: 'restored',
            action: {
              callId: 'tc_r',
              toolName: 'search',
              toolArgs: {},
              status: 'pending',
            },
          }),
        ],
      }),
    );

    expect(node.timeline.map(i => i.kind)).toEqual(['thought', 'tool']);
    expect(node.timeline[0]).toMatchObject({
      kind: 'thought',
      content: 'restored',
    });
  });

  it('derives timeline from steps on historical load (drops empty thoughts)', () => {
    const node = new MessageNode({
      id: 'm1',
      conversationId: 'c1',
      role: Role.ASSIST,
      createdAt: new Date(),
      status: 'completed',
      steps: [
        step({
          thought: 'reason first',
          action: {
            callId: 'tc_1',
            toolName: 'search',
            toolArgs: {},
            status: 'completed',
          },
          observation: 'obs',
          completedAt: 2,
        }),
        step({
          thought: '',
          action: {
            callId: 'tc_2',
            toolName: 'search',
            toolArgs: {},
            status: 'completed',
          },
          observation: 'obs2',
          completedAt: 4,
        }),
      ],
    });

    expect(node.timeline.map(i => i.kind)).toEqual(['thought', 'tool', 'tool']);
    expect(node.timeline[0]).toMatchObject({
      kind: 'thought',
      content: 'reason first',
    });
  });
});

describe('MessageNode — 终态文案', () => {
  it('cancelled 投影将取消原因写入 content', () => {
    const node = liveNode();
    node.applyView(view({ status: 'cancelled', content: 'Cancelled by user' }));

    expect(node.status).toBe('cancelled');
    expect(node.content).toBe('Cancelled by user');
  });

  it('cancelled 投影覆盖先前流式的部分文本', () => {
    const node = liveNode();
    node.applyView(view({ status: 'running', content: '部分…' }));
    node.applyView(view({ status: 'cancelled', content: 'Cancelled by user' }));

    expect(node.content).toBe('Cancelled by user');
  });

  it('error 投影将错误信息写入 content', () => {
    const node = liveNode();
    node.applyView(view({ status: 'failed', content: 'upstream blew up' }));

    expect(node.status).toBe('failed');
    expect(node.content).toBe('upstream blew up');
  });

  it('终态后忽略迟到的投影帧（不回退已终态节点）', () => {
    const node = liveNode();
    node.applyView(view({ status: 'completed', content: 'done' }));
    node.applyView(view({ status: 'running', content: 'stale' }));

    expect(node.status).toBe('completed');
    expect(node.content).toBe('done');
  });
});

describe('MessageNode — audio', () => {
  it('audio 投影写入 node.audio', () => {
    const node = liveNode();
    node.applyView(
      view({
        audio: { filePath: 'tts/run_1.mp3', voice: 'zh_female_x' },
      }),
    );

    expect(node.audio).toEqual({
      filePath: 'tts/run_1.mp3',
      voice: 'zh_female_x',
    });
  });

  it('历史消息从 data.audio 水合（重载后仍有音频）', () => {
    const node = new MessageNode({
      id: 'm1',
      conversationId: 'c1',
      role: Role.ASSIST,
      createdAt: new Date(),
      status: 'completed',
      content: 'hi',
      audio: { filePath: 'tts/old.mp3' },
    });

    expect(node.audio).toEqual({ filePath: 'tts/old.mp3' });
  });
});

describe('MessageNode — isCompacting', () => {
  const responseUserStep = (status: 'pending' | 'completed'): ReActStep =>
    step({
      action: {
        callId: 'tc_ru',
        toolName: 'response_user',
        toolArgs: {},
        status,
      },
      completedAt: status === 'completed' ? 2 : undefined,
    });

  it('response_user 交付后、final 前处于折叠窗口', () => {
    const node = liveNode();
    node.applyView(
      view({ status: 'running', steps: [responseUserStep('completed')] }),
    );
    expect(node.isCompacting).toBe(true);
  });

  it('final 到达后退出折叠窗口', () => {
    const node = liveNode();
    node.applyView(
      view({ status: 'running', steps: [responseUserStep('completed')] }),
    );
    node.applyView(
      view({ status: 'completed', steps: [responseUserStep('completed')] }),
    );
    expect(node.isCompacting).toBe(false);
  });

  it('无 response_user 时不进入折叠窗口', () => {
    const node = liveNode();
    node.applyView(view({ status: 'running', content: 'ans' }));
    expect(node.isCompacting).toBe(false);
  });

  it('response_user 仍 pending 时不进入折叠窗口', () => {
    const node = liveNode();
    node.applyView(
      view({ status: 'running', steps: [responseUserStep('pending')] }),
    );
    expect(node.isCompacting).toBe(false);
  });
});
