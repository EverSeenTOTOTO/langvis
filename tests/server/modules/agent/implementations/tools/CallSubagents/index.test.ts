import { describe, it, expect, vi } from 'vitest';
import type { EnrichedEvent } from '@/shared/types/events';
import type { LaunchParams } from '@/server/modules/agent/application/service/agent-run-executor';
import { ToolSet } from '@/server/modules/agent/domain/model/tool-set.vo';
import { ToolIds } from '@/shared/constants';
import CallSubagentsTool from '@/server/modules/agent/implementations/tools/CallSubagents/index';

function makeCtx(input: unknown, signal?: AbortSignal) {
  return {
    callId: 'tc_parent',
    input,
    signal: signal ?? new AbortController().signal,
    workDir: '/tmp/wd',
    llm: {},
    chatModelId: undefined,
    runId: 'run_parent',
    runtimeConfig: { model: { modelId: 'p:m' } },
  } as never;
}

async function drain<T, R>(
  gen: AsyncGenerator<T, R>,
): Promise<{ yielded: T[]; value: R }> {
  const yielded: T[] = [];
  let value!: R;
  while (true) {
    const r = await gen.next();
    if (r.done) {
      value = r.value;
      break;
    }
    yielded.push(r.value);
  }
  return { yielded, value };
}

describe('CallSubagentsTool', () => {
  it('launches children concurrently, re-yields their events as tool_progress, aggregates allSettled', async () => {
    let callIdx = 0;
    const launch = vi.fn((params: LaunchParams) => {
      const idx = callIdx++;
      return (async function* (): AsyncGenerator<EnrichedEvent> {
        yield { type: 'start', runId: params.runId, at: 0 };
        if (idx === 0) {
          yield {
            type: 'tool_call',
            callId: 'c',
            toolName: ToolIds.RESPONSE_USER,
            toolArgs: { message: 'A done' },
            runId: params.runId,
            at: 0,
          } as EnrichedEvent;
          yield { type: 'final', runId: params.runId, at: 0 };
        } else {
          yield {
            type: 'error',
            error: 'boom',
            runId: params.runId,
            at: 0,
          };
        }
      })();
    });
    const buildToolSet = vi.fn(() =>
      ToolSet.of([
        { id: 'response_user', mode: 'inline' },
        { id: 'call_subagents', mode: 'inline' },
        { id: 'ask_user', mode: 'inline' },
      ]),
    );
    const agentService = {
      buildToolSet,
      buildSystemPrompt: () => 'P',
    } as never;
    const executor = { launch } as never;

    const tool = new CallSubagentsTool(executor, agentService);
    const { yielded, value } = await drain(
      tool.call(
        makeCtx({
          children: [
            { brief: 'b1', query: 'q1' },
            { brief: 'b2', query: 'q2' },
          ],
        }),
      ),
    );

    // child ToolSet excludes call_subagents + ask_user
    expect(buildToolSet).toHaveBeenCalledWith([
      ToolIds.CALL_SUBAGENTS,
      ToolIds.ASK_USER,
    ]);
    expect(launch).toHaveBeenCalledTimes(2);

    // first two yields are per-child started blobs ({ childRunId, brief, query }),
    // rest are the children's events re-yielded as tool_progress
    expect(yielded).toHaveLength(7); // 2 started + child0(3) + child1(2)
    const startedBlobs = yielded.slice(0, 2) as Array<{
      data: { childRunId: string; brief: string; query: string };
    }>;
    expect(startedBlobs[0].data).toMatchObject({ brief: 'b1', query: 'q1' });
    expect(startedBlobs[1].data).toMatchObject({ brief: 'b2', query: 'q2' });

    const eventBlobs = yielded.slice(2);
    expect(
      eventBlobs.every(e => (e as { type: string }).type === 'tool_progress'),
    ).toBe(true);
    expect(
      eventBlobs.every(e => (e as { callId: string }).callId === 'tc_parent'),
    ).toBe(true);
    expect(
      new Set(
        eventBlobs.map(
          e => (e as { data: { childRunId: string } }).data.childRunId,
        ),
      ).size,
    ).toBe(2);
    // started blobs' runIds are exactly the children that emitted events
    expect(
      startedBlobs.every(s =>
        eventBlobs.some(
          e =>
            (e as { data: { childRunId: string } }).data.childRunId ===
            s.data.childRunId,
        ),
      ),
    ).toBe(true);

    // aggregated results: one completed (with response), one failed
    expect(value.results).toHaveLength(2);
    const completed = value.results.find(
      (r: { status: string }) => r.status === 'completed',
    );
    expect(completed?.response).toBe('A done');
    expect(
      value.results.some((r: { status: string }) => r.status === 'failed'),
    ).toBe(true);
  });

  it('passes parentSignal / workDir / runtimeConfig / seed to each child launch', async () => {
    const launch = vi.fn((params: LaunchParams) =>
      (async function* (): AsyncGenerator<EnrichedEvent> {
        yield { type: 'final', runId: params.runId, at: 0 };
      })(),
    );
    const agentService = {
      buildToolSet: () => ToolSet.of([]),
      buildSystemPrompt: () => 'P',
    } as never;
    const executor = { launch } as never;
    const tool = new CallSubagentsTool(executor, agentService);

    const controller = new AbortController();
    await tool
      .call(
        makeCtx({ children: [{ brief: 'b', query: 'q' }] }, controller.signal),
      )
      .next();

    const params = launch.mock.calls[0][0] as LaunchParams;
    expect(params.parentSignal).toBe(controller.signal);
    expect(params.interactive).toBe(false);
    expect(params.workDir).toBe('/tmp/wd');
    expect(params.runtimeConfig).toEqual({ model: { modelId: 'p:m' } });
    expect(params.seed[0]).toMatchObject({ role: 'system' });
    expect(params.seed[1]).toMatchObject({ role: 'user', content: 'q' });
  });
});
