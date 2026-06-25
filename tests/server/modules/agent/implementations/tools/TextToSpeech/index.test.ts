import { describe, it, expect, vi } from 'vitest';
import TextToSpeechTool from '@/server/modules/agent/implementations/tools/TextToSpeech';
import type { ToolCallContext } from '@/server/modules/agent/domain/port/tool-call-context.port';
import type { LlmPort } from '@/server/modules/agent/domain/port/llm.port';
import { winstonLogger } from '@/server/utils/logger';

// @tool 装饰器经 DI 才注入 logger；直接 new 时手动补上。
function makeTool(): TextToSpeechTool {
  const tool = new TextToSpeechTool();
  (tool as any).logger = winstonLogger;
  return tool;
}

function makeCtx(input: Record<string, unknown>): {
  ctx: ToolCallContext;
  tts: ReturnType<typeof vi.fn>;
} {
  const tts = vi.fn(
    async (_modelId: string, params: { reqId: string; voice: string }) => ({
      voice: params.voice,
      filePath: `tts/${params.reqId}.mp3`,
    }),
  );
  const ctx = {
    callId: 'tc_1',
    input,
    signal: new AbortController().signal,
    workDir: '/tmp',
    llm: { tts } as unknown as LlmPort,
    runId: 'run_42',
    runtimeConfig: {},
  } as unknown as ToolCallContext;
  return { ctx, tts };
}

// TextToSpeech.call 是无 yield 的 async generator，首次 next() 即跑到 return。
async function run(ctx: ToolCallContext) {
  const { value } = await makeTool().call(ctx).next();
  return value!;
}

describe('TextToSpeechTool', () => {
  it('用 input 的 voice 合成；reqId 缺省回退 runId；modelId 由 input 决定', async () => {
    const { ctx, tts } = makeCtx({ text: 'hi', voice: 'V1', modelId: 'M1' });
    const out = await run(ctx);

    expect(tts).toHaveBeenCalledTimes(1);
    const [modelId, params] = tts.mock.calls[0]!;
    expect(modelId).toBe('M1');
    expect(params).toMatchObject({ text: 'hi', voice: 'V1', reqId: 'run_42' });
    expect(out).toEqual({ voice: 'V1', filePath: 'tts/run_42.mp3' });
  });

  it('reqId 显式传入时优先使用', async () => {
    const { ctx, tts } = makeCtx({ text: 'hi', voice: 'V1', reqId: 'custom' });
    await run(ctx);
    const [, params] = tts.mock.calls[0]!;
    expect(params.reqId).toBe('custom');
  });

  it('缺少 voice 时抛错（不再回退任何配置）', async () => {
    const { ctx } = makeCtx({ text: 'hi' });
    await expect(makeTool().call(ctx).next()).rejects.toThrow(/voice/i);
  });
});
