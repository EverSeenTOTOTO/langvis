import { describe, it, expect, vi } from 'vitest';
import { UsageStage } from '@/server/modules/conversation/application/stages/usage-stage';
import {
  BakeSummaryStage,
  buildProcessSummary,
} from '@/server/modules/conversation/application/stages/bake-summary-stage';
import { ConvFoldStage } from '@/server/modules/conversation/application/stages/conv-fold-stage';
import { ReconstructStage } from '@/server/modules/conversation/application/stages/reconstruct-stage';
import { StagePlan } from '@/server/shared/context';
import { projectToLlmMessages } from '@/server/modules/conversation/application/service/history-projection';
import type { ConversationConfig } from '@/server/modules/conversation/domain/config';
import { ModelRegistryService } from '@/server/infrastructure/model-registry.service';
import { Role } from '@/shared/entities/Message';
import type { Message } from '@/shared/types/entities';
import type { StreamFrame, EnrichedEvent } from '@/shared/types/events';
import type { MessageRepositoryPort } from '@/server/modules/conversation/domain/port/message.repository.port';
import { ToolService } from '@/server/modules/agent/application/service/tool.service';
import type { Tool } from '@/server/modules/agent/domain/model/tool.base';

const { foldMock } = vi.hoisted(() => ({ foldMock: vi.fn() }));
vi.mock('@/server/shared/compaction/summarizer', () => ({ fold: foldMock }));

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
): import('@/server/shared/context').ConvTarget {
  return {
    kind: 'conv',
    conversationId: 'conv_test',
    messages: messages,
    runtimeConfig: { context: { convFold: COMPACTION } },
    getRunEvents: (messageId: string) => runEvents[messageId],
  };
}

function mockProvider(contextSize: number): ModelRegistryService {
  return {
    resolveContextSize: () => contextSize,
  } as unknown as ModelRegistryService;
}

async function collect(gen: AsyncGenerator<any, any, any>) {
  const out: any[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

describe('conv transform 清单（CONTEXT_STAGES 显式发现）', () => {
  const buildTransforms = () => [
    new BakeSummaryStage(
      {
        batchCreate: vi.fn(),
        update: vi.fn(),
      } as unknown as MessageRepositoryPort,
      { getAllToolInfo: async () => [] } as never,
    ),
    new ReconstructStage(
      {
        batchCreate: vi.fn(),
        update: vi.fn(),
      } as unknown as MessageRepositoryPort,
      mockProvider(8000),
    ),
    new ConvFoldStage(
      {
        batchCreate: vi.fn(),
        update: vi.fn(),
      } as unknown as MessageRepositoryPort,
      mockProvider(8000),
      { chatContent: vi.fn(async () => 'S') } as never,
    ),
    new UsageStage(mockProvider(8000)),
  ];

  it('清单覆盖四个 stage', () => {
    const registered = buildTransforms().map(s => s.constructor);
    expect(registered).toContain(UsageStage);
    expect(registered).toContain(BakeSummaryStage);
    expect(registered).toContain(ReconstructStage);
    expect(registered).toContain(ConvFoldStage);
  });

  it('相位分桶：process-summary+reconstruct+summarize+usage 进 turn-end，usage 进 activated', () => {
    const plan = new StagePlan(buildTransforms() as never);
    const ids = (ts: readonly { id: string }[]) => ts.map(t => t.id);
    expect(ids(plan.forPhase('activated'))).toEqual(['usage']);
    expect(ids(plan.forPhase('turn-start'))).toEqual([]);
    // 导入序即运行序：烘 summary 列 → 选择性截断胖用户消息 → 折叠全对话为 C → 量压缩后用量
    expect(ids(plan.forPhase('turn-end'))).toEqual([
      'bake-summary',
      'reconstruct',
      'conv-fold',
      'usage',
    ]);
  });
});

describe('UsageStage', () => {
  it('从 ctx.messages + 派生 contextSize 算用量并 yield conversation_usage', async () => {
    const ctx = makeCtx([makeMessage(Role.USER, 'hello world question')]);
    const events = await collect(new UsageStage(mockProvider(8000)).apply(ctx));
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
  runtimeConfig: ConversationConfig = {
    context: { runFold: LOOP_COMPACTION },
  } as ConversationConfig,
): import('@/server/shared/context').ConvTarget {
  return {
    kind: 'conv',
    conversationId: 'conv_test',
    messages: messages,
    runtimeConfig,
    getRunEvents: (messageId: string) => runEvents[messageId],
  };
}

const NO_DESCRIBE_TOOL = {} as unknown as Tool;

function toolServiceWith(tools: Record<string, Tool>): ToolService {
  return {
    resolve: (id: string) => tools[id],
  } as unknown as ToolService;
}

describe('BakeSummaryStage', () => {
  it('buildProcessSummary：按 callId 配对，有 describe 自述，否则走通用回退', () => {
    const describeFn = vi.fn(
      (input: { cmd?: unknown }, _output: unknown, error: string) =>
        `custom ${input.cmd} → ${error ? 'ERR' : 'OK'}`,
    );
    const tools: Record<string, Tool> = {
      Bash: { describe: describeFn } as unknown as Tool,
      X: NO_DESCRIBE_TOOL,
    };
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
      ev({
        type: 'tool_call',
        callId: 'c2',
        toolName: 'X',
        toolArgs: { a: 1 },
      }),
      ev({ type: 'tool_error', callId: 'c2', toolName: 'X', error: 'boom' }),
      ev({ type: 'start' }),
    ];
    const summary = buildProcessSummary(
      events as readonly EnrichedEvent[],
      id => tools[id],
    );
    expect(describeFn).toHaveBeenCalledWith({ cmd: 'ls' }, 'a b', undefined);
    expect(summary).toBe('1. custom ls → OK\n2. X(a=1) → Error: boom');
  });

  it('通用回退：未实现 describe 时用 toolName(args) → 结果模板', () => {
    const events = [
      ev({
        type: 'tool_call',
        callId: 'c',
        toolName: 'NoDescribe',
        toolArgs: { cmd: 'ls' },
      }),
      ev({
        type: 'tool_result',
        callId: 'c',
        toolName: 'NoDescribe',
        output: { ok: true },
      }),
    ];
    const summary = buildProcessSummary(
      events as readonly EnrichedEvent[],
      () => NO_DESCRIBE_TOOL,
    );
    expect(summary).toBe('1. NoDescribe(cmd=ls) → {"ok":true}');
  });

  it('response_user（终端交付）不写入摘要', () => {
    const events = [
      ev({
        type: 'tool_call',
        callId: 'c1',
        toolName: 'Bash',
        toolArgs: { cmd: 'ls' },
      }),
      ev({ type: 'tool_result', callId: 'c1', toolName: 'Bash', output: 'o1' }),
      ev({
        type: 'tool_call',
        callId: 'c2',
        toolName: 'response_user',
        toolArgs: { message: 'final answer' },
      }),
      ev({
        type: 'tool_result',
        callId: 'c2',
        toolName: 'response_user',
        output: { delivered: true },
      }),
    ];
    const summary = buildProcessSummary(
      events as readonly EnrichedEvent[],
      () => NO_DESCRIBE_TOOL,
    );
    expect(summary).toBe('1. Bash(cmd=ls) → "o1"');
  });

  it('无 outcome（无 tool_call）→ null', () => {
    const events = [ev({ type: 'thought', content: 'only' })];
    expect(
      buildProcessSummary(events as readonly EnrichedEvent[], () => undefined),
    ).toBeNull();
  });

  it('有 runCtx + events 时确定性写 meta.summary（不覆盖既有 meta 键）', async () => {
    const toolService = toolServiceWith({ Bash: NO_DESCRIBE_TOOL });
    const update = vi.fn(async (_id: string, partial: any) => partial);
    const messageRepo = { update } as unknown as MessageRepositoryPort;
    const events = [
      ev({
        type: 'tool_call',
        callId: 'c1',
        toolName: 'Bash',
        toolArgs: { cmd: 'ls' },
      }),
      ev({ type: 'tool_result', callId: 'c1', toolName: 'Bash', output: 'o1' }),
      ev({
        type: 'tool_call',
        callId: 'c2',
        toolName: 'Bash',
        toolArgs: { cmd: 'pwd' },
      }),
      ev({ type: 'tool_result', callId: 'c2', toolName: 'Bash', output: 'o2' }),
    ];
    const ctx = loopCtx(
      [makeMessage(Role.ASSIST, 'ans', { id: 'msg_1', meta: { foo: 'bar' } })],
      { msg_1: events as readonly EnrichedEvent[] },
    );
    await collect(
      new BakeSummaryStage(messageRepo, toolService).apply({
        ...ctx,
        runCtx: {
          messageId: 'msg_1',
          runId: 'run_1',
        },
      }),
    );
    expect(foldMock).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith('msg_1', {
      meta: {
        foo: 'bar',
        summary: '1. Bash(cmd=ls) → "o1"\n2. Bash(cmd=pwd) → "o2"',
      },
    });
  });

  it('无 runCtx（非 turn-end）跳过', async () => {
    const toolService = toolServiceWith({});
    const messageRepo = { update: vi.fn() } as unknown as MessageRepositoryPort;
    const ctx = loopCtx([makeMessage(Role.ASSIST, 'a')], {});
    await collect(new BakeSummaryStage(messageRepo, toolService).apply(ctx));
    expect(messageRepo.update).not.toHaveBeenCalled();
  });

  it('trivial turn（工具调用 ≤1）跳过', async () => {
    const toolService = toolServiceWith({});
    const messageRepo = { update: vi.fn() } as unknown as MessageRepositoryPort;
    const ctx = loopCtx([makeMessage(Role.ASSIST, 'a', { id: 'msg_1' })], {
      msg_1: [
        ev({ type: 'thought', content: 'only' }),
      ] as readonly EnrichedEvent[],
    });
    await collect(
      new BakeSummaryStage(messageRepo, toolService).apply({
        ...ctx,
        runCtx: {
          messageId: 'msg_1',
          runId: 'run_1',
        },
      }),
    );
    expect(messageRepo.update).not.toHaveBeenCalled();
  });

  it('缺 runtimeConfig.loop 跳过', async () => {
    const toolService = toolServiceWith({});
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
      new BakeSummaryStage(messageRepo, toolService).apply({
        ...ctx,
        runCtx: {
          messageId: 'msg_1',
          runId: 'run_1',
        },
      }),
    );
    expect(messageRepo.update).not.toHaveBeenCalled();
  });

  it('events 缺失（getRunEvents 返回 undefined）跳过', async () => {
    const toolService = toolServiceWith({});
    const messageRepo = { update: vi.fn() } as unknown as MessageRepositoryPort;
    const ctx = loopCtx([makeMessage(Role.ASSIST, 'a', { id: 'msg_1' })], {});
    await collect(
      new BakeSummaryStage(messageRepo, toolService).apply({
        ...ctx,
        runCtx: {
          messageId: 'msg_1',
          runId: 'run_1',
        },
      }),
    );
    expect(messageRepo.update).not.toHaveBeenCalled();
  });
});

describe('ConvFoldStage', () => {
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
      new ConvFoldStage(messageRepo, mockProvider(1_000_000), {
        chatContent: vi.fn(async () => 'S'),
      } as never).apply(ctx),
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
      new ConvFoldStage(messageRepo, mockProvider(10), {
        chatContent: vi.fn(async () => 'S'),
      } as never).apply(ctx),
    );
    expect(events).toHaveLength(0); // summarize 不发帧
    expect(foldMock).toHaveBeenCalledTimes(1);
    expect(messageRepo.batchCreate).toHaveBeenCalledTimes(1);
    expect(ctx.messages.length).toBe(5); // 4 + C
    const compactMsg = ctx.messages[4]!;
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
      new ConvFoldStage(messageRepo, mockProvider(10), {
        chatContent: vi.fn(async () => 'S'),
      } as never).apply(ctx),
    );
    expect(messageRepo.batchCreate).not.toHaveBeenCalled();
    expect(ctx.messages.length).toBe(2);
  });
});

describe('ReconstructStage（选择性重构：低阈、保细节、打 meta.reconstructed 标记落库，投影读取时截头部，原正文不改）', () => {
  function mockRepo() {
    return {
      update: vi.fn(async (_id: string, partial: any) => partial),
    } as unknown as MessageRepositoryPort;
  }

  it('未超 reconstructThreshold → 不动（不标记、不 update）', async () => {
    // history 带 reconstructThreshold=0.5；contextSize 大到 used ≤ limit → 跳过。
    const ctx: Record<string, any> = {
      conversationId: 'conv_test',
      messages: [makeMessage(Role.USER, 'q'), makeMessage(Role.ASSIST, 'a')],
      runtimeConfig: {
        context: {
          convFold: {
            reconstructThreshold: 0.5,
            threshold: 0.99,
            windowSize: 10,
          },
        },
      },
      transforms: new StagePlan(),
      getRunEvents: () => undefined,
    } as unknown as Record<string, any>;
    const before = ctx.messages.length;
    const repo = mockRepo();
    await collect(
      new ReconstructStage(repo, mockProvider(1_000_000)).apply(
        ctx as import('@/server/shared/context').StageTarget,
      ),
    );
    expect(ctx.messages.length).toBe(before);
    expect(ctx.messages[0]!.meta?.reconstructed).toBeUndefined();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('超 reconstructThreshold → 打 meta.reconstructed 标记并落库；原正文不动、近窗口保真、投影截头部', async () => {
    // history 带 reconstructThreshold=0.5 + keepRecent=1；长用户消息在 tail 首位、出窗 → 标记。
    const longBody = 'y'.repeat(10_000);
    const longMsg = makeMessage(Role.USER, longBody, { id: 'msg_long' });
    const ctx: Record<string, any> = {
      conversationId: 'conv_test',
      messages: [
        longMsg,
        makeMessage(Role.ASSIST, 'a1'),
        makeMessage(Role.USER, 'q2', { id: 'msg_q2' }),
      ],
      runtimeConfig: {
        context: {
          convFold: {
            reconstructThreshold: 0.5,
            reconstructKeepRecent: 1,
            threshold: 0.99,
            windowSize: 10,
          },
        },
      },
      stages: new StagePlan(),
      getRunEvents: () => undefined,
    } as unknown as Record<string, any>;
    const repo = mockRepo();
    await collect(
      new ReconstructStage(repo, mockProvider(10)).apply({
        ...ctx,
        kind: 'conv',
      } as import('@/server/shared/context').StageTarget),
    );
    // 原正文不动（非破坏）；打了标记；落库 update。
    expect(ctx.messages[0]!.content).toBe(longBody);
    expect(ctx.messages[0]!.meta?.reconstructed).toBe(true);
    expect(repo.update).toHaveBeenCalledWith('msg_long', {
      meta: { reconstructed: true },
    });
    // 近窗口内的短用户消息不打标。
    expect(ctx.messages[2]!.content).toBe('q2');
    expect(ctx.messages[2]!.meta?.reconstructed).toBeUndefined();
    // 投影读取时按标记截断头部（原正文仍全量在库）。
    const projected = projectToLlmMessages(ctx.messages);
    const projectedLong = projected.find(m => m.content.includes('truncated'))!;
    expect(projectedLong).toBeDefined();
    expect(projectedLong.content.length).toBeLessThan(longBody.length);
  });

  it('缺 reconstructThreshold → 跳过', async () => {
    // COMPACTION 无 reconstructThreshold → 不重构。
    const ctx = makeCtx([
      makeMessage(Role.USER, 'y'.repeat(10_000)),
      makeMessage(Role.ASSIST, 'a'),
    ]);
    const before = ctx.messages[0]!.content;
    const repo = mockRepo();
    await collect(
      new ReconstructStage(repo, mockProvider(10)).apply({
        ...ctx,
        kind: 'conv',
      } as import('@/server/shared/context').StageTarget),
    );
    expect(ctx.messages[0]!.content).toBe(before); // 未动
    expect(ctx.messages[0]!.meta?.reconstructed).toBeUndefined();
    expect(repo.update).not.toHaveBeenCalled();
  });

  it('已标记的消息不重复标记（幂等）', async () => {
    const longBody = 'y'.repeat(10_000);
    const ctx: Record<string, any> = {
      conversationId: 'conv_test',
      messages: [
        makeMessage(Role.USER, longBody, {
          id: 'msg_long',
          meta: { reconstructed: true },
        }),
        makeMessage(Role.ASSIST, 'a1'),
        makeMessage(Role.USER, 'q2', { id: 'msg_q2' }),
      ],
      runtimeConfig: {
        context: {
          convFold: {
            reconstructThreshold: 0.5,
            reconstructKeepRecent: 1,
            threshold: 0.99,
            windowSize: 10,
          },
        },
      },
      stages: new StagePlan(),
      getRunEvents: () => undefined,
    } as unknown as Record<string, any>;
    const repo = mockRepo();
    await collect(
      new ReconstructStage(repo, mockProvider(10)).apply({
        ...ctx,
        kind: 'conv',
      } as import('@/server/shared/context').StageTarget),
    );
    expect(repo.update).not.toHaveBeenCalled(); // 已标记 → 不重复 update
  });
});
