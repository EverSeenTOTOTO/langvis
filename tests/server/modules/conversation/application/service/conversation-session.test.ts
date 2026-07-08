import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationSession } from '@/server/modules/conversation/application/service/conversation-session';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';
import type { SSEFrame, EnrichedEvent } from '@/shared/types/events';

type RunViewFrame = Extract<SSEFrame, { type: 'run_view' }>;

/** Collect run_view frames from a spy's call list, narrowed off the SSEFrame union. */
function runViews(calls: SSEFrame[][]): RunViewFrame[] {
  return calls
    .filter(c => c[0]?.type === 'run_view')
    .map(c => c[0] as RunViewFrame);
}

function msg(
  role: Role,
  content: string,
  meta?: Record<string, unknown>,
): Message {
  return {
    id: `m_${role}_${content}`,
    role,
    content,
    attachments: null,
    meta: meta ?? null,
    createdAt: new Date(),
    conversationId: 'c1',
  };
}

const CONFIG = { contextSize: 8000, modelId: 'gpt-4', runtimeConfig: {} };
const makeSession = (id = 'c1') =>
  new ConversationSession(id, 30_000, () => {});

describe('ConversationSession —— 会话记忆成员（ConversationMemory 宿主）', () => {
  it('activateMemory + getMemory.buildContext 返回有效历史；getContextUsage 用量', async () => {
    const s = makeSession();
    s.activateMemory(
      [msg(Role.SYSTEM, 'sys'), msg(Role.USER, 'q1'), msg(Role.ASSIST, 'a1')],
      CONFIG,
    );
    const ctx = await s.getMemory().buildContext();
    expect(ctx.some(m => m.content === 'q1')).toBe(true);
    expect(s.getMemory().getContextUsage().total).toBe(8000);
  });

  it('append 经 getMemory 反映到 buildContext', async () => {
    const s = makeSession();
    s.activateMemory([msg(Role.SYSTEM, 'sys')], CONFIG);
    s.getMemory().append(msg(Role.USER, 'q2'));
    const ctx = await s.getMemory().buildContext();
    expect(ctx.some(m => m.content === 'q2')).toBe(true);
  });

  it('未 activateMemory 时 getMemory 抛错（fail loud）', () => {
    const s = makeSession();
    expect(() => s.getMemory()).toThrow();
  });

  it('dispose 后 getMemory 抛错（记忆随会话释放）', () => {
    const s = makeSession();
    s.activateMemory([msg(Role.SYSTEM, 'sys')], CONFIG);
    s.dispose();
    expect(() => s.getMemory()).toThrow();
  });
});

describe('ConversationSession —— handleRunEvent → run_view 投影帧', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('loop_usage 翻译为控制帧且不缓冲', () => {
    const s = makeSession();
    s.registerRun('m1', 'r1');
    const sendFrame = vi.spyOn(s, 'sendFrame');

    const usage = {
      type: 'loop_usage',
      used: 5,
      total: 4096,
      runId: 'r1',
      seq: 3,
      at: 0,
    } as EnrichedEvent;
    s.handleRunEvent('m1', usage);
    expect(sendFrame).toHaveBeenCalledWith({
      type: 'loop_usage',
      runId: 'r1',
      used: 5,
      total: 4096,
    });
    expect(s.getRunEvents('m1')).toEqual([]);
  });

  it('普通事件缓冲，合并窗口后下发 run_view（取最新视图）', () => {
    const s = makeSession();
    s.registerRun('m1', 'r1');
    const sendFrame = vi.spyOn(s, 'sendFrame');

    const thought = {
      type: 'thought',
      content: 'hi',
      runId: 'r1',
      seq: 4,
      at: 0,
    } as EnrichedEvent;
    s.handleRunEvent('m1', thought);
    // 事件缓冲入流（CompleteTurn 仍按事件流持久化）
    expect(s.getRunEvents('m1')?.map(e => e.type)).toEqual(['thought']);
    // 合并窗口内尚未下发
    expect(runViews(sendFrame.mock.calls)).toHaveLength(0);

    vi.advanceTimersByTime(30);
    const rv = runViews(sendFrame.mock.calls);
    expect(rv).toHaveLength(1);
    expect(rv[0]).toMatchObject({
      type: 'run_view',
      messageId: 'm1',
      runId: 'r1',
      status: 'running',
    });
    expect(rv[0].steps[0].thought).toBe('hi');
  });

  it('合并窗口内 N 个事件只下发一帧', () => {
    const s = makeSession();
    s.registerRun('m1', 'r1');
    const sendFrame = vi.spyOn(s, 'sendFrame');

    for (let i = 0; i < 3; i++) {
      s.handleRunEvent('m1', {
        type: 'text_chunk',
        content: 'abc'[i],
        runId: 'r1',
        seq: i + 1,
        at: 0,
      } as EnrichedEvent);
    }
    vi.advanceTimersByTime(30);
    const rv = runViews(sendFrame.mock.calls);
    expect(rv).toHaveLength(1);
    expect(rv[0].content).toBe('abc');
  });

  it('removeRun drain 同步下发终态 run_view（合并窗口未触发也保证送达）', () => {
    const s = makeSession();
    s.registerRun('m1', 'r1');
    const sendFrame = vi.spyOn(s, 'sendFrame');

    s.handleRunEvent('m1', {
      type: 'text_chunk',
      content: 'ans',
      runId: 'r1',
      seq: 1,
      at: 0,
    } as EnrichedEvent);
    s.handleRunEvent('m1', {
      type: 'final',
      runId: 'r1',
      seq: 2,
      at: 0,
    } as EnrichedEvent);
    // 合并窗口内尚未下发（定时器 pending）
    expect(runViews(sendFrame.mock.calls)).toHaveLength(0);

    // removeRun = run 生命周期终结：drain 同步下发最终视图，再摘除 run。
    s.removeRun('m1');

    const rv = runViews(sendFrame.mock.calls);
    expect(rv).toHaveLength(1);
    expect(rv[0]).toMatchObject({
      type: 'run_view',
      messageId: 'm1',
      status: 'completed',
      content: 'ans',
    });
  });

  it('awaiting_input 随合并窗口下发 run_view', () => {
    const s = makeSession();
    s.registerRun('m1', 'r1');
    const sendFrame = vi.spyOn(s, 'sendFrame');

    s.handleRunEvent('m1', {
      type: 'tool_call',
      callId: 'tc_1',
      toolName: 'ask_user',
      toolArgs: {},
      runId: 'r1',
      seq: 1,
      at: 0,
    } as EnrichedEvent);
    s.handleRunEvent('m1', {
      type: 'tool_progress',
      callId: 'tc_1',
      data: {
        status: 'awaiting_input',
        message: 'ok?',
        schema: { type: 'object' },
      },
      runId: 'r1',
      seq: 2,
      at: 0,
    } as EnrichedEvent);
    // 合并窗口内不同步下发
    expect(runViews(sendFrame.mock.calls)).toHaveLength(0);
    vi.advanceTimersByTime(30);

    const rv = runViews(sendFrame.mock.calls);
    expect(rv).toHaveLength(1);
    expect(rv[0].awaitingInput).toMatchObject({
      callId: 'tc_1',
      message: 'ok?',
    });
  });

  it('removeRun drain 下发后，合并定时器不再重复下发', () => {
    const s = makeSession();
    s.registerRun('m1', 'r1');
    const sendFrame = vi.spyOn(s, 'sendFrame');

    s.handleRunEvent('m1', {
      type: 'text_chunk',
      content: 'x',
      runId: 'r1',
      seq: 1,
      at: 0,
    } as EnrichedEvent);
    s.removeRun('m1');
    // drain 已下发一帧
    expect(runViews(sendFrame.mock.calls)).toHaveLength(1);
    // run 已摘除，原合并定时器（已被 drain 清掉）即便推进也不重复
    vi.advanceTimersByTime(30);
    expect(runViews(sendFrame.mock.calls)).toHaveLength(1);
  });
});
