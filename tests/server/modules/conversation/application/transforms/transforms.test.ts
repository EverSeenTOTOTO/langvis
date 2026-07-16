import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import { resolveConvTransforms } from '@/server/modules/conversation/application/transforms';
import { UsageTransform } from '@/server/modules/conversation/application/transforms/usage-transform';
import {
  ProcessSummaryTransform,
  eventsToTrajectory,
} from '@/server/modules/conversation/application/transforms/process-summary-transform';
import { CompactTransform } from '@/server/modules/conversation/application/transforms/compact-transform';
import {
  ConvTransformPlan,
  type ConversationContext,
} from '@/server/modules/conversation/domain/model/conv-transform';
import { ListMonad } from '@/server/libs/list';
import type { ConversationConfig } from '@/server/libs/config';
import { ProviderService } from '@/server/libs/infrastructure/provider.service';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';
import type { StreamFrame, EnrichedEvent } from '@/shared/types/events';
import { MESSAGE_REPOSITORY } from '@/server/modules/conversation/conversation.di-tokens';
import type { MessageRepositoryPort } from '@/server/modules/conversation/domain/port/message.repository.port';

const { foldMock } = vi.hoisted(() => ({ foldMock: vi.fn() }));
vi.mock('@/server/libs/compaction/summarizer', () => ({ fold: foldMock }));

const COMPACTION = { threshold: 0.8, windowSize: 10 };

function makeMessage(
  role: Role,
  content: string,
  extra: Partial<Message> = {},
): Message {
  return {
    id: `msg_${role}_${content}`,
    role,
    content,
    attachments: null,
    meta: null,
    createdAt: new Date(),
    conversationId: 'conv_test',
    ...extra,
  };
}

function makeCtx(
  messages: Message[],
  runEvents: Record<string, readonly EnrichedEvent[]> = {},
): ConversationContext {
  return {
    conversationId: 'conv_test',
    messages: ListMonad.of(messages),
    runtimeConfig: { history: COMPACTION },
    transforms: new ConvTransformPlan(),
    getRunEvents: (messageId: string) => runEvents[messageId],
  };
}

function mockProvider(contextSize: number): ProviderService {
  return {
    resolveContextSize: () => contextSize,
  } as unknown as ProviderService;
}

async function collect(gen: AsyncGenerator<StreamFrame | void>) {
  const out: (StreamFrame | void)[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('conv transform registry（自动识别）', () => {
  beforeEach(() => {
    container.register(MESSAGE_REPOSITORY, {
      useValue: {
        batchCreate: vi.fn(),
        update: vi.fn(),
      } as unknown as MessageRepositoryPort,
    });
  });
  afterEach(() => container.clearInstances());

  it('resolveConvTransforms 发现 @convTransform 标记的三个 transform', () => {
    const transforms = resolveConvTransforms();
    expect(transforms.some(t => t instanceof UsageTransform)).toBe(true);
    expect(transforms.some(t => t instanceof ProcessSummaryTransform)).toBe(
      true,
    );
    expect(transforms.some(t => t instanceof CompactTransform)).toBe(true);
  });

  it('相位分桶：process-summary+compact+usage 进 turn-end，usage 进 activated', () => {
    const plan = new ConvTransformPlan(resolveConvTransforms());
    const ids = (ts: readonly { id: string }[]) => ts.map(t => t.id);
    expect(ids(plan.forPhase('activated'))).toEqual(['usage']);
    expect(ids(plan.forPhase('turn-start'))).toEqual([]);
    // 导入序即运行序：烘 summary 列 → 折叠历史 → 量压缩后用量
    expect(ids(plan.forPhase('turn-end'))).toEqual([
      'process-summary',
      'compact',
      'usage',
    ]);
  });
});

describe('UsageTransform', () => {
  it('从 ctx.messages + 派生 contextSize 算用量并 yield conversation_usage', async () => {
    const ctx = makeCtx([makeMessage(Role.USER, 'hello world question')]);
    const events = await collect(
      new UsageTransform(mockProvider(8000)).apply(ctx),
    );
    expect(events).toHaveLength(1);
    const usage = events[0] as Extract<
      StreamFrame,
      { type: 'conversation_usage' }
    >;
    expect(usage.type).toBe('conversation_usage');
    expect(usage.total).toBe(8000);
    expect(usage.used).toBeTypeOf('number');
  });
});

const LOOP_COMPACTION = { threshold: 0.8, windowSize: 10, keepRecent: 4 };

function ev(p: { type: string } & Record<string, unknown>): EnrichedEvent {
  return { runId: 'run_1', seq: 0, at: 0, ...p } as EnrichedEvent;
}

function loopCtx(
  messages: Message[],
  runEvents: Record<string, readonly EnrichedEvent[]>,
  runtimeConfig: ConversationConfig = { loop: LOOP_COMPACTION },
): ConversationContext {
  return {
    conversationId: 'conv_test',
    messages: ListMonad.of(messages),
    runtimeConfig,
    transforms: new ConvTransformPlan(),
    getRunEvents: (messageId: string) => runEvents[messageId],
  };
}

describe('ProcessSummaryTransform', () => {
  beforeEach(() => {
    foldMock.mockReset();
  });

  it('eventsToTrajectory：thought/tool_call+args/tool_result/tool_error → ReAct 轨迹', () => {
    const events = [
      ev({ type: 'thought', content: 'plan' }),
      ev({
        type: 'tool_call',
        callId: 'c1',
        toolName: 'Bash',
        toolArgs: { cmd: 'ls' },
      }),
      ev({
        type: 'tool_result',
        callId: 'c1',
        toolName: 'Bash',
        output: 'a b',
      }),
      ev({ type: 'tool_error', callId: 'c2', toolName: 'X', error: 'boom' }),
      ev({ type: 'start' }),
    ];
    const traj = eventsToTrajectory(events as readonly EnrichedEvent[]);
    expect(traj.map(m => m.role)).toEqual([
      'assistant',
      'assistant',
      'user',
      'user',
    ]);
    expect(traj[1].content).toContain('Bash');
    expect(traj[2].content).toContain('Observation:');
    expect(traj[3].content).toContain('Error: boom');
  });

  it('有 runCtx + events 时 fold → 写 meta.summary（不覆盖既有 meta 键）', async () => {
    foldMock.mockResolvedValue('THE PS');
    const update = vi.fn(async (_id: string, partial: any) => partial);
    const messageRepo = { update } as unknown as MessageRepositoryPort;
    const events = [
      ev({ type: 'thought', content: 't1' }),
      ev({ type: 'tool_call', callId: 'c1', toolName: 'Bash', toolArgs: {} }),
      ev({ type: 'tool_result', callId: 'c1', toolName: 'Bash', output: 'o1' }),
    ];
    const ctx = loopCtx(
      [makeMessage(Role.ASSIST, 'ans', { id: 'msg_1', meta: { foo: 'bar' } })],
      { msg_1: events as readonly EnrichedEvent[] },
    );
    await collect(
      new ProcessSummaryTransform(messageRepo).apply(ctx, {
        messageId: 'msg_1',
        runId: 'run_1',
      }),
    );
    expect(foldMock).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith('msg_1', {
      meta: { foo: 'bar', summary: 'THE PS' },
    });
  });

  it('无 runCtx（非 turn-end）跳过', async () => {
    foldMock.mockResolvedValue('PS');
    const messageRepo = { update: vi.fn() } as unknown as MessageRepositoryPort;
    const ctx = loopCtx([makeMessage(Role.ASSIST, 'a')], {});
    await collect(new ProcessSummaryTransform(messageRepo).apply(ctx));
    expect(foldMock).not.toHaveBeenCalled();
    expect(messageRepo.update).not.toHaveBeenCalled();
  });

  it('trivial turn（轨迹 ≤1）跳过', async () => {
    foldMock.mockResolvedValue('PS');
    const messageRepo = { update: vi.fn() } as unknown as MessageRepositoryPort;
    const ctx = loopCtx([makeMessage(Role.ASSIST, 'a', { id: 'msg_1' })], {
      msg_1: [
        ev({ type: 'thought', content: 'only' }),
      ] as readonly EnrichedEvent[],
    });
    await collect(
      new ProcessSummaryTransform(messageRepo).apply(ctx, {
        messageId: 'msg_1',
        runId: 'run_1',
      }),
    );
    expect(foldMock).not.toHaveBeenCalled();
  });

  it('缺 runtimeConfig.loop 跳过', async () => {
    foldMock.mockResolvedValue('PS');
    const messageRepo = { update: vi.fn() } as unknown as MessageRepositoryPort;
    const ctx = loopCtx(
      [makeMessage(Role.ASSIST, 'a', { id: 'msg_1' })],
      {
        msg_1: [
          ev({ type: 'thought', content: 't' }),
          ev({ type: 'tool_call', callId: 'c', toolName: 'B', toolArgs: {} }),
        ] as readonly EnrichedEvent[],
      },
      {},
    );
    await collect(
      new ProcessSummaryTransform(messageRepo).apply(ctx, {
        messageId: 'msg_1',
        runId: 'run_1',
      }),
    );
    expect(foldMock).not.toHaveBeenCalled();
  });

  it('events 缺失（getRunEvents 返回 undefined）跳过', async () => {
    foldMock.mockResolvedValue('PS');
    const messageRepo = { update: vi.fn() } as unknown as MessageRepositoryPort;
    const ctx = loopCtx([makeMessage(Role.ASSIST, 'a', { id: 'msg_1' })], {});
    await collect(
      new ProcessSummaryTransform(messageRepo).apply(ctx, {
        messageId: 'msg_1',
        runId: 'run_1',
      }),
    );
    expect(foldMock).not.toHaveBeenCalled();
  });

  it('fold 返回空时不 persist', async () => {
    foldMock.mockResolvedValue('');
    const messageRepo = { update: vi.fn() } as unknown as MessageRepositoryPort;
    const events = [
      ev({ type: 'thought', content: 't' }),
      ev({ type: 'tool_call', callId: 'c', toolName: 'B', toolArgs: {} }),
    ];
    const ctx = loopCtx([makeMessage(Role.ASSIST, 'a', { id: 'msg_1' })], {
      msg_1: events as readonly EnrichedEvent[],
    });
    await collect(
      new ProcessSummaryTransform(messageRepo).apply(ctx, {
        messageId: 'msg_1',
        runId: 'run_1',
      }),
    );
    expect(messageRepo.update).not.toHaveBeenCalled();
  });
});

describe('CompactTransform', () => {
  beforeEach(() => {
    foldMock.mockReset();
  });

  it('未超阈时不动（不 fold、不 persist）', async () => {
    foldMock.mockResolvedValue('RECAP');
    const messageRepo = {
      batchCreate: vi.fn(),
    } as unknown as MessageRepositoryPort;
    const ctx = makeCtx([
      makeMessage(Role.USER, 'q'),
      makeMessage(Role.ASSIST, 'a'),
    ]);
    const before = ctx.messages.length;
    await collect(
      new CompactTransform(messageRepo, mockProvider(1_000_000)).apply(ctx),
    );
    expect(foldMock).not.toHaveBeenCalled();
    expect(messageRepo.batchCreate).not.toHaveBeenCalled();
    expect(ctx.messages.length).toBe(before);
  });

  it('超阈时 fold → persist C → append 到 ctx.messages（不发帧）', async () => {
    foldMock.mockResolvedValue('THE RECAP');
    const messageRepo = {
      batchCreate: vi.fn(async (convId: string, msgs: any[]) => [
        {
          ...msgs[0],
          id: 'compact_1',
          conversationId: convId,
          attachments: null,
        },
      ]),
    } as unknown as MessageRepositoryPort;
    const ctx = makeCtx([
      makeMessage(Role.USER, 'question one'),
      makeMessage(Role.ASSIST, 'answer one'),
      makeMessage(Role.USER, 'question two'),
      makeMessage(Role.ASSIST, 'answer two'),
    ]);

    const events = await collect(
      new CompactTransform(messageRepo, mockProvider(10)).apply(ctx),
    );
    expect(events).toHaveLength(0); // compact 不发帧
    expect(foldMock).toHaveBeenCalledTimes(1);
    expect(messageRepo.batchCreate).toHaveBeenCalledTimes(1);
    expect(ctx.messages.length).toBe(5); // 4 + C
    const compactMsg = ctx.messages.get(4)!;
    expect(compactMsg.role).toBe(Role.USER);
    expect(compactMsg.meta?.kind).toBe('compact');
    expect(compactMsg.content).toBe('THE RECAP');
  });

  it('fold 返回空时不 persist', async () => {
    foldMock.mockResolvedValue('');
    const messageRepo = {
      batchCreate: vi.fn(),
    } as unknown as MessageRepositoryPort;
    const ctx = makeCtx([
      makeMessage(Role.USER, 'q one'),
      makeMessage(Role.ASSIST, 'a one'),
    ]);
    await collect(
      new CompactTransform(messageRepo, mockProvider(10)).apply(ctx),
    );
    expect(messageRepo.batchCreate).not.toHaveBeenCalled();
    expect(ctx.messages.length).toBe(2);
  });
});
