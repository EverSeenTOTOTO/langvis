import { describe, it, expect } from 'vitest';
import ResponseUserTool from '@/server/modules/agent/implementations/tools/ResponseUser';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { RunEvent } from '@/shared/types/events';

function makeCtx(input: Record<string, unknown>): ToolCallContext {
  return {
    callId: 'tc_1',
    input,
    signal: new AbortController().signal,
    workDir: '/tmp',
    llm: {} as any,
    runId: 'run_1',
  };
}

async function collect(
  gen: AsyncGenerator<RunEvent, { delivered: boolean }, void>,
): Promise<{ events: RunEvent[]; output: { delivered: boolean } }> {
  const events: RunEvent[] = [];
  let result: IteratorResult<RunEvent, { delivered: boolean }>;
  while (!(result = await gen.next()).done) {
    events.push(result.value);
  }
  return { events, output: result.value };
}

describe('ResponseUserTool', () => {
  it('yields a text_chunk with the message and returns delivered', async () => {
    const tool = new ResponseUserTool();
    (tool as any).logger = { info: () => {} };
    const ctx = makeCtx({ message: '你好！有什么我可以帮你的吗？' });

    const { events, output } = await collect(tool.call(ctx));

    expect(events).toEqual([
      { type: 'text_chunk', content: '你好！有什么我可以帮你的吗？' },
    ]);
    expect(output).toEqual({ delivered: true });
  });

  it('respects abort signal', async () => {
    const tool = new ResponseUserTool();
    (tool as any).logger = { info: () => {} };
    const controller = new AbortController();
    controller.abort();
    const ctx = { ...makeCtx({ message: 'x' }), signal: controller.signal };

    await expect(async () => {
      for await (const _ of tool.call(ctx)) {
        // drain
      }
    }).rejects.toThrow();
  });
});
