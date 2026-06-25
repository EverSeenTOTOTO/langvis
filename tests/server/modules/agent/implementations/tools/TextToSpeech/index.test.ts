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

function makeCtx(
  input: Record<string, unknown>,
  runtimeConfig: Record<string, unknown> = {},
): { ctx: ToolCallContext; tts: ReturnType<typeof vi.fn> } {
  const tts = vi.fn(
    async (_modelId: string, params: { reqId: string; voice: string }) => ({
      voice: params.voice,
      filePath: `/tmp/${params.reqId}.mp3`,
    }),
  );
  const ctx = {
    callId: 'tc_1',
    input,
    signal: new AbortController().signal,
    workDir: '/tmp',
    llm: { tts } as unknown as LlmPort,
    runId: 'run_42',
    runtimeConfig,
  } as unknown as ToolCallContext;
  return { ctx, tts };
}

// TextToSpeech.call 是无 yield 的 async generator，首次 next() 即跑到 return。
async function run(ctx: ToolCallContext) {
  const { value } = await makeTool().call(ctx).next();
  return value!;
}

describe('TextToSpeechTool 配置兜底', () => {
  it('input 的 voice 优先于 config', async () => {
    const { ctx, tts } = makeCtx(
      { text: 'hi', voice: 'V_INPUT' },
      { tts: { voice: 'V_CFG', modelId: 'M_CFG' } },
    );
    await run(ctx);
    expect(tts).toHaveBeenCalledTimes(1);
    const [, params] = tts.mock.calls[0]!;
    expect(params.voice).toBe('V_INPUT');
    expect(params.modelId).toBe('M_CFG'); // modelId 仍取 config
    expect(params.reqId).toBe('run_42'); // reqId 兜底 runId
  });

  it('voice/modelId 缺省时回退 config.tts', async () => {
    const { ctx, tts } = makeCtx(
      { text: 'hi' },
      { tts: { voice: 'V_CFG', modelId: 'M_CFG' } },
    );
    await run(ctx);
    const [modelId, params] = tts.mock.calls[0]!;
    expect(modelId).toBe('M_CFG');
    expect(params.voice).toBe('V_CFG');
  });

  it('reqId 缺省时回退 runId', async () => {
    const { ctx, tts } = makeCtx(
      { text: 'hi', voice: 'V1' },
      { tts: { modelId: 'M1' } },
    );
    await run(ctx);
    const [, params] = tts.mock.calls[0]!;
    expect(params.reqId).toBe('run_42');
  });

  it('voice 既无 input 又无 config 时抛错', async () => {
    const { ctx } = makeCtx({ text: 'hi' }, {});
    await expect(makeTool().call(ctx).next()).rejects.toThrow(/voice/i);
  });
});
