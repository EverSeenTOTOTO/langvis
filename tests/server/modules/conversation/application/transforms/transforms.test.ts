import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { container } from 'tsyringe';
import { resolveConvTransforms } from '@/server/modules/conversation/application/transforms';
import { UsageTransform } from '@/server/modules/conversation/application/transforms/usage-transform';
import { SummaryBakeTransform } from '@/server/modules/conversation/application/transforms/summary-bake-transform';
import { CompactTransform } from '@/server/modules/conversation/application/transforms/compact-transform';
import {
  ConvTransformPlan,
  type ConversationContext,
} from '@/server/modules/conversation/domain/model/conv-transform';
import { ListMonad } from '@/server/libs/list';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';
import type { StreamFrame } from '@/shared/types/events';
import { MESSAGE_REPOSITORY } from '@/server/modules/conversation/conversation.di-tokens';
import { AGENT_RUN_REPOSITORY } from '@/server/modules/agent/agent.di-tokens';
import type { MessageRepositoryPort } from '@/server/modules/conversation/domain/port/message.repository.port';
import type { AgentRunRepositoryPort } from '@/server/modules/agent/domain/port/agent-run.repository.port';

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

function makeCtx(messages: Message[], contextSize = 10): ConversationContext {
  return {
    conversationId: 'conv_test',
    messages: ListMonad.of(messages),
    config: { contextSize, runtimeConfig: { history: COMPACTION } },
    transforms: new ConvTransformPlan(),
  };
}

async function collect(gen: AsyncGenerator<StreamFrame | void>) {
  const out: (StreamFrame | void)[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('conv transform registry（自动识别）', () => {
  beforeEach(() => {
    container.register(MESSAGE_REPOSITORY, {
      useValue: { batchCreate: vi.fn() } as unknown as MessageRepositoryPort,
    });
    container.register(AGENT_RUN_REPOSITORY, {
      useValue: { findByIds: vi.fn() } as unknown as AgentRunRepositoryPort,
    });
  });
  afterEach(() => container.clearInstances());

  it('resolveConvTransforms 发现 @convTransform 标记的三个 transform', () => {
    const transforms = resolveConvTransforms();
    expect(transforms.some(t => t instanceof UsageTransform)).toBe(true);
    expect(transforms.some(t => t instanceof SummaryBakeTransform)).toBe(true);
    expect(transforms.some(t => t instanceof CompactTransform)).toBe(true);
  });

  it('相位分桶：summary-bake 进 turn-start+turn-end，compact 进 turn-end，usage 进 activated+turn-end', () => {
    const plan = new ConvTransformPlan(resolveConvTransforms());
    const ids = (ts: readonly { id: string }[]) => ts.map(t => t.id);
    expect(ids(plan.forPhase('activated'))).toEqual(['usage']);
    expect(ids(plan.forPhase('turn-start'))).toEqual(['summary-bake']);
    // 导入序即运行序：烘焙 → 折叠 → 量用量
    expect(ids(plan.forPhase('turn-end'))).toEqual([
      'summary-bake',
      'compact',
      'usage',
    ]);
  });
});

describe('UsageTransform', () => {
  it('从 ctx.messages + contextSize 算用量并 yield conversation_usage', async () => {
    const ctx = makeCtx([makeMessage(Role.USER, 'hello world question')], 8000);
    const events = await collect(new UsageTransform().apply(ctx));
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

describe('SummaryBakeTransform', () => {
  it('按 agentRunId 取 processSummary 并前缀 <summary> 到 assistant', async () => {
    const agentRunRepo = {
      findByIds: vi.fn(async () => [
        { id: 'run_1', processSummary: 'did X then Y' },
      ]),
    } as unknown as AgentRunRepositoryPort;
    const ctx = makeCtx([
      makeMessage(Role.USER, 'q'),
      makeMessage(Role.ASSIST, 'a', { agentRunId: 'run_1' }),
    ]);
    await collect(new SummaryBakeTransform(agentRunRepo).apply(ctx));
    const assist = ctx.messages.get(1)!;
    expect(assist.content).toBe('<summary>did X then Y</summary>\n\na');
    expect(agentRunRepo.findByIds).toHaveBeenCalledWith(['run_1']);
  });

  it('幂等：重复 apply 不二次前缀', async () => {
    const agentRunRepo = {
      findByIds: vi.fn(async () => [{ id: 'run_1', processSummary: 'PS' }]),
    } as unknown as AgentRunRepositoryPort;
    const t = new SummaryBakeTransform(agentRunRepo);
    const ctx = makeCtx([
      makeMessage(Role.ASSIST, 'a', { agentRunId: 'run_1' }),
    ]);
    await collect(t.apply(ctx));
    await collect(t.apply(ctx)); // 第二次：bakedRunIds 命中，不再查 repo
    expect(agentRunRepo.findByIds).toHaveBeenCalledTimes(1);
    expect(ctx.messages.get(0)!.content).toBe('<summary>PS</summary>\n\na');
  });

  it('无未烘焙 assistant 时不动、不查 repo', async () => {
    const agentRunRepo = {
      findByIds: vi.fn(),
    } as unknown as AgentRunRepositoryPort;
    const ctx = makeCtx([makeMessage(Role.USER, 'q')]);
    await collect(new SummaryBakeTransform(agentRunRepo).apply(ctx));
    expect(agentRunRepo.findByIds).not.toHaveBeenCalled();
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
    const ctx = makeCtx(
      [makeMessage(Role.USER, 'q'), makeMessage(Role.ASSIST, 'a')],
      1_000_000,
    );
    const before = ctx.messages.length;
    await collect(new CompactTransform(messageRepo).apply(ctx));
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
    const ctx = makeCtx(
      [
        makeMessage(Role.USER, 'question one'),
        makeMessage(Role.ASSIST, 'answer one'),
        makeMessage(Role.USER, 'question two'),
        makeMessage(Role.ASSIST, 'answer two'),
      ],
      10, // 阈值 8 token，几条消息即超
    );

    const events = await collect(new CompactTransform(messageRepo).apply(ctx));
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
    const ctx = makeCtx(
      [makeMessage(Role.USER, 'q one'), makeMessage(Role.ASSIST, 'a one')],
      10,
    );
    await collect(new CompactTransform(messageRepo).apply(ctx));
    expect(messageRepo.batchCreate).not.toHaveBeenCalled();
    expect(ctx.messages.length).toBe(2);
  });
});
