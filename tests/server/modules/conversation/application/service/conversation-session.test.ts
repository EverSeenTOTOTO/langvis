import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConversationSession } from '@/server/modules/conversation/application/service/conversation-session';
import { Transport } from '@/shared/transport';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';
import type { StreamFrame, EnrichedEvent } from '@/shared/types/events';
import { ConvTransformPlan } from '@/server/modules/conversation/domain/model/conv-transform';

class MockTransport extends Transport<StreamFrame> {
  isConnected = true;
  isConnecting = false;
  connect = vi.fn().mockResolvedValue(undefined);
  send = vi.fn((_f: StreamFrame) => true);
  close = vi.fn(() => {
    this.isConnected = false;
  });
  disconnect = vi.fn();
  fireDisconnect() {
    this.dispatchEvent(new Event('disconnect'));
  }
}

type RunViewFrame = Extract<StreamFrame, { type: 'run_view' }>;

/** Collect run_view frames from a spy's call list, narrowed off the StreamFrame union. */
function runViews(calls: StreamFrame[][]): RunViewFrame[] {
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

const CONFIG = { contextSize: 8000, runtimeConfig: {} };
const makeSession = (id = 'c1') =>
  new ConversationSession(id, 30_000, () => {});

describe('ConversationSession —— 会话上下文（messages/config/transforms 宿主）', () => {
  it('activateContext + getCtx：messages 可读、config 暴露 contextSize', () => {
    const s = makeSession();
    s.activateContext(
      [msg(Role.SYSTEM, 'sys'), msg(Role.USER, 'q1'), msg(Role.ASSIST, 'a1')],
      CONFIG,
      new ConvTransformPlan(),
    );
    const ctx = s.getCtx();
    expect(ctx.messages.toArray().some(m => m.content === 'q1')).toBe(true);
    expect(ctx.config.contextSize).toBe(8000);
  });

  it('append 经 ctx.messages 反映', () => {
    const s = makeSession();
    s.activateContext(
      [msg(Role.SYSTEM, 'sys')],
      CONFIG,
      new ConvTransformPlan(),
    );
    const ctx = s.getCtx();
    ctx.messages = ctx.messages.append(msg(Role.USER, 'q2'));
    expect(ctx.messages.toArray().some(m => m.content === 'q2')).toBe(true);
  });

  it('未 activateContext 时 getCtx 抛错（fail loud）', () => {
    const s = makeSession();
    expect(() => s.getCtx()).toThrow();
  });

  it('dispose 后 getCtx 抛错（上下文随会话释放）', () => {
    const s = makeSession();
    s.activateContext(
      [msg(Role.SYSTEM, 'sys')],
      CONFIG,
      new ConvTransformPlan(),
    );
    s.dispose();
    expect(() => s.getCtx()).toThrow();
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
      at: 0,
    } as EnrichedEvent);
    s.handleRunEvent('m1', {
      type: 'final',
      runId: 'r1',
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
      at: 0,
    } as EnrichedEvent);
    s.removeRun('m1');
    // drain 已下发一帧
    expect(runViews(sendFrame.mock.calls)).toHaveLength(1);
    // run 已摘除，原合并定时器（已被 drain 清掉）即便推进也不重复
    vi.advanceTimersByTime(30);
    expect(runViews(sendFrame.mock.calls)).toHaveLength(1);
  });

  it('getChildRunEvents 从活跃父 run 缓冲提取子 run 事件', () => {
    const s = makeSession();
    s.registerRun('m_parent', 'run_parent');
    // 灌入父 run 事件（含子 run 转发块）
    s.handleRunEvent('m_parent', {
      type: 'tool_call',
      callId: 'tc_sa',
      toolName: 'call_subagents',
      toolArgs: {},
      runId: 'run_parent',
      at: 0,
    } as EnrichedEvent);
    s.handleRunEvent('m_parent', {
      type: 'tool_progress',
      callId: 'tc_sa',
      data: {
        childRunId: 'run_child',
        event: {
          type: 'thought',
          content: 'child thinks',
          runId: 'run_child',
          at: 0,
        } as EnrichedEvent,
      },
      runId: 'run_parent',
      at: 0,
    } as EnrichedEvent);

    const child = s.getChildRunEvents('run_child');
    expect(child?.map(e => e.type)).toEqual(['thought']);
    expect(s.getChildRunEvents('run_nonexistent')).toBeUndefined();
  });
});

describe('ConversationSession —— 活跃 run 期间不 idle 释放', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('有活跃 run 且传输断开时，idle 到期也不释放；run 结束后才释放', () => {
    const onConnectionLost = vi.fn();
    const s = new ConversationSession('c1', 1000, onConnectionLost);
    const transport = new MockTransport();
    s.attachTransport(transport);
    s.registerRun('m1', 'r1');

    // 传输断开（代理 idle 断连）→ Connection idle 计时启动。
    transport.fireDisconnect();

    // 活跃 run 中——idle 到期也必须保留会话（run 仍可查、可取消）。
    vi.advanceTimersByTime(1000);
    expect(onConnectionLost).not.toHaveBeenCalled();
    expect(s.hasActiveRun('m1')).toBe(true);

    // run 结束 → removeRun 后空闲，markIdle 重新计时并释放。
    s.removeRun('m1');
    s.markIdle();
    vi.advanceTimersByTime(1000);
    expect(onConnectionLost).toHaveBeenCalledTimes(1);
  });
});
