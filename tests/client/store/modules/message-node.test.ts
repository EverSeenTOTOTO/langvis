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

describe('MessageNode — 终态文案', () => {
  it('cancelled 帧将取消原因写入 content（供气泡渲染）', () => {
    const node = liveNode();
    node.handleFrame(
      frame({ seq: 1, type: 'cancelled', reason: 'Cancelled by user' }),
    );

    expect(node.status).toBe('cancelled');
    expect(node.cancelReason).toBe('Cancelled by user');
    expect(node.content).toBe('Cancelled by user');
  });

  it('cancelled 帧覆盖已流式的部分文本', () => {
    const node = liveNode();
    node.handleFrame(frame({ seq: 1, type: 'text_chunk', content: '部分…' }));
    node.handleFrame(
      frame({ seq: 2, type: 'cancelled', reason: 'Cancelled by user' }),
    );

    expect(node.content).toBe('Cancelled by user');
  });

  it('error 帧将错误信息写入 content', () => {
    const node = liveNode();
    node.handleFrame(
      frame({ seq: 1, type: 'error', error: 'upstream blew up' }),
    );

    expect(node.status).toBe('failed');
    expect(node.error).toBe('upstream blew up');
    expect(node.content).toBe('upstream blew up');
  });
});

describe('MessageNode — audio', () => {
  it('audio 帧写入 node.audio（供内容底部渲染播放器）', () => {
    const node = liveNode();
    node.handleFrame(
      frame({
        seq: 1,
        type: 'audio',
        filePath: 'tts/run_1.mp3',
        voice: 'zh_female_x',
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
  it('response_user 交付后、final 前处于折叠窗口', () => {
    const node = liveNode();
    node.handleFrame(frame({ seq: 1, type: 'text_chunk', content: 'ans' }));
    node.handleFrame(
      frame({
        seq: 2,
        type: 'tool_call',
        callId: 'tc_ru',
        toolName: 'response_user',
        toolArgs: {},
      }),
    );
    node.handleFrame(
      frame({ seq: 3, type: 'tool_result', callId: 'tc_ru', output: 'ok' }),
    );

    expect(node.isCompacting).toBe(true);
  });

  it('final 到达后退出折叠窗口', () => {
    const node = liveNode();
    node.handleFrame(
      frame({
        seq: 1,
        type: 'tool_call',
        callId: 'tc_ru',
        toolName: 'response_user',
        toolArgs: {},
      }),
    );
    node.handleFrame(
      frame({ seq: 2, type: 'tool_result', callId: 'tc_ru', output: 'ok' }),
    );
    node.handleFrame(frame({ seq: 3, type: 'final' }));

    expect(node.isCompacting).toBe(false);
  });

  it('无 response_user 时不进入折叠窗口', () => {
    const node = liveNode();
    node.handleFrame(frame({ seq: 1, type: 'text_chunk', content: 'ans' }));

    expect(node.isCompacting).toBe(false);
  });

  it('response_user 仍 pending 时不进入折叠窗口', () => {
    const node = liveNode();
    node.handleFrame(
      frame({
        seq: 1,
        type: 'tool_call',
        callId: 'tc_ru',
        toolName: 'response_user',
        toolArgs: {},
      }),
    );

    expect(node.isCompacting).toBe(false);
  });
});
