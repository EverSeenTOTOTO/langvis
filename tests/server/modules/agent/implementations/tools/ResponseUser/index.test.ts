import { describe, it, expect, vi } from 'vitest';
import ResponseUserTool from '@/server/modules/agent/implementations/tools/ResponseUser';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { LlmPort } from '@/server/libs/ports/llm/llm.port';
import type { RunEvent } from '@/shared/types/events';

function makeCtx(
  input: Record<string, unknown>,
  ttsImpl?: ReturnType<typeof vi.fn>,
): { ctx: ToolCallContext; tts: ReturnType<typeof vi.fn> } {
  const tts =
    ttsImpl ?? vi.fn(async () => ({ voice: 'V', filePath: 'tts/run_1.mp3' }));
  const ctx = {
    callId: 'tc_1',
    input,
    signal: new AbortController().signal,
    workDir: '/tmp',
    llm: { tts } as unknown as LlmPort,
    chatModelId: undefined,
    runId: 'run_1',
    runtimeConfig: {},
  } as unknown as ToolCallContext;
  return { ctx, tts };
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

function makeTool(): ResponseUserTool {
  const tool = new ResponseUserTool();
  (tool as any).logger = { info: () => {}, warn: () => {} };
  return tool;
}

describe('ResponseUserTool', () => {
  it('无 tts：仅 text_chunk + delivered，不合成', async () => {
    const { ctx, tts } = makeCtx({ message: '你好！有什么我可以帮你的吗？' });
    const { events, output } = await collect(makeTool().call(ctx));

    expect(events).toEqual([
      { type: 'text_chunk', content: '你好！有什么我可以帮你的吗？' },
    ]);
    expect(output).toEqual({ delivered: true });
    expect(tts).not.toHaveBeenCalled();
  });

  it('tts.enabled=false：不合成、无 audio', async () => {
    const { ctx, tts } = makeCtx({
      message: 'hi',
      tts: { enabled: false, voice: 'V' },
    });
    const { events } = await collect(makeTool().call(ctx));

    expect(events).toEqual([{ type: 'text_chunk', content: 'hi' }]);
    expect(tts).not.toHaveBeenCalled();
  });

  it('tts.enabled=true：合成并 yield audio 事件', async () => {
    const { ctx, tts } = makeCtx({
      message: 'hi',
      tts: { enabled: true, voice: 'zh_female_x', emotion: 'hate' },
    });
    const { events, output } = await collect(makeTool().call(ctx));

    expect(events[0]).toEqual({ type: 'text_chunk', content: 'hi' });
    expect(events[1]).toEqual({
      type: 'audio',
      filePath: 'tts/run_1.mp3',
      voice: 'V',
    });
    expect(output).toEqual({ delivered: true });
    expect(tts).toHaveBeenCalledTimes(1);
    const [modelId, params] = tts.mock.calls[0]!;
    expect(modelId).toBeUndefined();
    expect(params).toMatchObject({
      text: 'hi',
      voice: 'zh_female_x',
      emotion: 'hate',
      reqId: 'run_1',
    });
  });

  it('tts.enabled=true 但无 voice：告警、无 audio、不抛', async () => {
    const { ctx, tts } = makeCtx({ message: 'hi', tts: { enabled: true } });
    const { events, output } = await collect(makeTool().call(ctx));

    expect(events).toEqual([{ type: 'text_chunk', content: 'hi' }]);
    expect(output).toEqual({ delivered: true });
    expect(tts).not.toHaveBeenCalled();
  });

  it('tts 合成失败：文本仍交付、不抛、无 audio', async () => {
    const tts = vi.fn(async () => {
      throw new Error('boom');
    });
    const { ctx } = makeCtx(
      { message: 'hi', tts: { enabled: true, voice: 'V' } },
      tts,
    );
    const { events, output } = await collect(makeTool().call(ctx));

    expect(events).toEqual([{ type: 'text_chunk', content: 'hi' }]);
    expect(output).toEqual({ delivered: true });
  });

  it('respects abort signal', async () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = { ...makeCtx({ message: 'x' }).ctx, signal: controller.signal };

    await expect(async () => {
      for await (const _ of makeTool().call(ctx)) {
        // drain
      }
    }).rejects.toThrow();
  });
});
